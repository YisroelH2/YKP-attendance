-- Single-row table holding a remotely-bumpable "consent_version". The client
-- compares this against the version number it last got a checkbox-accept for
-- (stored in localStorage); bumping this row forces every signed-in device to
-- see the Privacy Policy consent gate again on next load, without a deploy.
create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  consent_version integer not null default 1,
  consent_bumped_at timestamptz,
  consent_bumped_by uuid references auth.users(id)
);

insert into public.app_settings (id, consent_version)
values (1, 1)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

create policy "staff full access" on public.app_settings
  for all using (true) with check (true);
