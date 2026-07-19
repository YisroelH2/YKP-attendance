-- Tracks every report-card / test-result send attempt, whether it's a single
-- test result sent from Grade Entry (test_id set, period_from/to null) or a
-- full period report card (period_from/to set, test_id null). Never updated
-- in place — always insert a new row — so this doubles as a full send
-- history per student. The most recent row for a given
-- (student_id, test_id) or (student_id, period_from, period_to) determines
-- current "sent" status; status='reset' lets a principal manually clear a
-- prior send so it stops counting as already-sent.
create table if not exists public.ykp_report_card_sends (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  test_id uuid references public.ykp_tests(id) on delete cascade,
  period_from date,
  period_to date,
  method text not null,   -- 'bulk_email' | 'share' | 'manual'
  recipient_emails text,
  status text not null,   -- 'success' | 'failed' | 'reset'
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ykp_rcs_student_idx on public.ykp_report_card_sends (student_id, created_at desc);
create index if not exists ykp_rcs_test_idx on public.ykp_report_card_sends (test_id, created_at desc);

alter table public.ykp_report_card_sends enable row level security;

create policy "staff full access" on public.ykp_report_card_sends
  for all using (true) with check (true);
