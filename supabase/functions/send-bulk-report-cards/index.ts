// Supabase Edge Function: send-bulk-report-cards
//
// Called from the frontend after it has already generated a PDF per student and
// uploaded each one to the `report-cards` storage bucket, creating a signed URL.
// This function receives that batch, fetches each PDF, and emails it to the
// student's parent via Resend — one email per student, never a shared/BCC send.
//
// Deploy:   supabase functions deploy send-bulk-report-cards
// Secrets:  supabase secrets set RESEND_API_KEY=re_xxx REPORT_CARD_FROM_EMAIL="YKP Reports <reports@yourdomain.com>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('REPORT_CARD_FROM_EMAIL') || 'onboarding@resend.dev';
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically into every edge
// function by the platform — no need to set these yourself.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReportCardItem {
  studentId: string;
  studentName: string;
  parentEmail: string;
  pdfUrl: string;
  fileName: string;
}
interface SendResult {
  studentId: string;
  success: boolean;
  error?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

function base64Encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000; // avoid call-stack blowups on large PDFs
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendOne(item: ReportCardItem): Promise<SendResult> {
  try {
    // parentEmail may hold more than one address, comma-separated (a family
    // with separate mom/dad emails on file) — send to all of them.
    const toEmails = (item.parentEmail || '').split(',').map((e) => e.trim()).filter(Boolean);
    if (!toEmails.length) throw new Error('No parent email');
    if (!item.pdfUrl) throw new Error('No PDF URL');

    const pdfRes = await fetch(item.pdfUrl);
    if (!pdfRes.ok) throw new Error(`Could not fetch PDF (${pdfRes.status})`);
    const pdfBuf = await pdfRes.arrayBuffer();
    const pdfBase64 = base64Encode(pdfBuf);

    const name = escapeHtml(item.studentName || 'your child');
    const subject = `Report Card — ${item.studentName || 'Student'}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">
        <p>Dear Parent,</p>
        <p>Here is the report card for <strong>${name}</strong> from Yeshivas Kayitz Program. It's attached to this email as a PDF.</p>
        <p>If the attachment doesn't come through, you can also view it directly here:
          <a href="${item.pdfUrl}">Download report card</a> (link active for 7 days).</p>
        <p>If you have any questions, feel free to reach out.</p>
        <p>Thank you,<br>YKP</p>
      </div>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: toEmails,
        subject,
        html,
        attachments: [
          {
            filename: item.fileName || `ReportCard-${item.studentId}.pdf`,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend ${emailRes.status}: ${errText}`);
    }

    return { studentId: item.studentId, success: true };
  } catch (err) {
    return {
      studentId: item.studentId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) {
    return jsonResponse({ error: 'RESEND_API_KEY is not configured on this Edge Function' }, 500);
  }

  // Require a real logged-in Supabase user — this endpoint sends email on the org's
  // behalf, so it must never be callable anonymously even if the anon key leaks.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let items: ReportCardItem[] = [];
  try {
    const body = await req.json();
    items = Array.isArray(body?.items) ? body.items : [];
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!items.length) return jsonResponse({ error: 'No items provided' }, 400);
  if (items.length > 300) return jsonResponse({ error: 'Too many items in one batch (max 300)' }, 400);

  const results: SendResult[] = [];
  // Sequential on purpose: keeps us well under Resend's rate limit and makes
  // per-item failures easy to isolate rather than racing a Promise.all.
  for (const item of items) {
    results.push(await sendOne(item));
  }

  return jsonResponse({ results });
});
