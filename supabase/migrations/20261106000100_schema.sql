-- PitchReady schema. Every tenant-owned row carries agency_id, and cross-table references use
-- composite (id, agency_id) foreign keys so a row in agency A can never point at agency B's data.
-- Requires Supabase's auth schema (auth.users, auth.uid()) and pgcrypto in the "extensions" schema.

create schema if not exists app_private;
create schema if not exists app_api;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tenancy
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  retention_days int not null default 30 check (retention_days between 1 and 365),
  seat_limit int not null default 5 check (seat_limit between 1 and 500),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.memberships (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('manager', 'rep')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  primary key (agency_id, user_id)
);
-- MVP decision (DECISIONS.md D6): a user belongs to at most one agency.
create unique index memberships_one_agency_per_user on public.memberships(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  role text not null check (role in ('manager', 'rep')),
  token_hash bytea not null unique check (length(token_hash) = 32),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, agency_id)
);
create index invitations_agency_idx on public.invitations(agency_id);

-- ---------------------------------------------------------------- content versions
create table public.rubric_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  version text not null check (length(version) between 1 and 40),
  dimensions jsonb not null check (jsonb_typeof(dimensions) = 'array' and jsonb_array_length(dimensions) = 5),
  prompt_version text not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, version),
  unique (id, agency_id)
);

create table public.campaign_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  campaign_key text not null check (campaign_key ~ '^[a-z0-9-]{3,80}$'),
  version int not null check (version >= 1),
  pack jsonb not null check (jsonb_typeof(pack -> 'approved_facts') = 'array'),
  rubric_version_id uuid,
  draft_rubric jsonb,
  state text not null check (state in ('draft', 'published')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (rubric_version_id, agency_id) references public.rubric_versions(id, agency_id),
  check (state = 'draft' or (rubric_version_id is not null and approved_at is not null))
);
create unique index campaign_versions_published_unique on public.campaign_versions(agency_id, campaign_key, version) where state = 'published';
create unique index campaign_versions_one_draft on public.campaign_versions(agency_id) where state = 'draft';

create table public.scenario_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  scenario_key text not null check (scenario_key in ('busy', 'existing-donor', 'sceptical', 'monthly-giving', 'firm-refusal')),
  version int not null check (version >= 1),
  title text not null,
  persona text not null,
  opener text not null,
  objection text not null,
  goal text not null,
  allowed_ending text not null,
  behaviour text not null,
  skill text not null,
  created_at timestamptz not null default now(),
  unique (agency_id, scenario_key, version),
  unique (id, agency_id)
);

-- ---------------------------------------------------------------- practice
create table public.usage_periods (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  allowance_seconds int not null check (allowance_seconds >= 0),
  consumed_seconds int not null default 0 check (consumed_seconds >= 0),
  reserved_seconds int not null default 0 check (reserved_seconds >= 0),
  spend_reserved_minor bigint not null default 0 check (spend_reserved_minor >= 0),
  spend_actual_minor bigint not null default 0 check (spend_actual_minor >= 0),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- The database itself refuses to over-reserve customer minutes.
  check (consumed_seconds + reserved_seconds <= allowance_seconds),
  unique (id, agency_id)
);
create index usage_periods_agency_idx on public.usage_periods(agency_id, starts_at desc);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  rep_id uuid not null,
  kind text not null check (kind in ('full', 'drill')),
  scenario_version_id uuid not null,
  drill_key text check (drill_key is null or drill_key in ('already-donate','busy','not-interested','cannot-afford','prefers-one-off','legitimacy','amount','money-use','cancellation','asks-to-end')),
  campaign_version_id uuid not null,
  rubric_version_id uuid not null,
  parent_session_id uuid,
  usage_period_id uuid not null,
  mode text not null default 'connected' check (mode = 'connected'),
  status text not null default 'created' check (status in ('created', 'active', 'ending', 'ended', 'failed', 'abandoned')),
  evaluation_status text not null default 'none' check (evaluation_status in ('none', 'pending', 'running', 'completed', 'unavailable')),
  max_seconds int not null check (max_seconds in (60, 180)),
  max_rep_turns int not null check (max_rep_turns between 1 and 12),
  start_request_id text not null check (length(start_request_id) between 8 and 100),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  deadline_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason is null or end_reason in ('rep_ended','resident_ended','time_limit','turn_limit','provider_failure','abandoned','membership_revoked')),
  used_seconds int check (used_seconds is null or used_seconds between 0 and 180),
  transcript_revision int not null default 1 check (transcript_revision >= 1),
  turn_lock text,
  turn_lock_at timestamptz,
  unique (id, agency_id),
  unique (agency_id, rep_id, start_request_id),
  foreign key (agency_id, rep_id) references public.memberships(agency_id, user_id),
  foreign key (scenario_version_id, agency_id) references public.scenario_versions(id, agency_id),
  foreign key (campaign_version_id, agency_id) references public.campaign_versions(id, agency_id),
  foreign key (rubric_version_id, agency_id) references public.rubric_versions(id, agency_id),
  foreign key (parent_session_id, agency_id) references public.sessions(id, agency_id) on delete set null (parent_session_id),
  foreign key (usage_period_id, agency_id) references public.usage_periods(id, agency_id),
  check (status = 'created' or started_at is not null or status in ('failed', 'abandoned')),
  check ((kind = 'drill') = (drill_key is not null))
);
create index sessions_rep_idx on public.sessions(agency_id, rep_id, created_at desc);
create index sessions_open_idx on public.sessions(status, deadline_at) where status in ('created', 'active', 'ending');
create unique index sessions_one_open_per_rep on public.sessions(rep_id) where status in ('created', 'active', 'ending');

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  session_id uuid not null,
  sequence int not null check (sequence between 1 and 40),
  label text not null check (label ~ '^(resident|rep)-[0-9]{1,3}$'),
  speaker text not null check (speaker in ('resident', 'rep')),
  text text not null check (length(text) <= 1200),
  source text not null check (source in ('typed', 'transcribed', 'scripted', 'generated')),
  request_id text,
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  unique (session_id, label),
  unique (session_id, request_id),
  foreign key (session_id, agency_id) references public.sessions(id, agency_id) on delete cascade,
  check (split_part(label, '-', 1) = speaker)
);

create table public.turn_corrections (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  session_id uuid not null,
  turn_label text not null,
  revision int not null check (revision >= 2),
  corrected_text text not null check (length(corrected_text) between 1 and 1200),
  note text check (note is null or length(note) <= 500),
  corrected_by uuid not null references auth.users(id),
  request_id text not null,
  created_at timestamptz not null default now(),
  unique (session_id, revision),
  unique (session_id, request_id),
  foreign key (session_id, agency_id) references public.sessions(id, agency_id) on delete cascade,
  foreign key (session_id, turn_label) references public.turns(session_id, label) on delete cascade
);

create table public.evaluation_jobs (
  agency_id uuid not null,
  session_id uuid not null,
  transcript_revision int not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, transcript_revision),
  foreign key (session_id, agency_id) references public.sessions(id, agency_id) on delete cascade
);
create index evaluation_jobs_pending_idx on public.evaluation_jobs(status, lease_until);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  session_id uuid not null,
  transcript_revision int not null,
  attempt int not null,
  status text not null check (status in ('completed', 'unavailable')),
  evaluator_kind text not null check (evaluator_kind in ('mock', 'anthropic')),
  result jsonb,
  model text,
  prompt_version text not null,
  errors jsonb,
  created_at timestamptz not null default now(),
  foreign key (session_id, agency_id) references public.sessions(id, agency_id) on delete cascade,
  check ((status = 'completed') = (result is not null))
);
-- At most one successful evaluation per transcript revision: duplicate retries cannot add another.
create unique index evaluations_one_success on public.evaluations(session_id, transcript_revision) where status = 'completed';

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  session_id uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('transcription_error', 'feedback_incorrect', 'other')),
  description text not null check (length(description) between 3 and 1000),
  turn_label text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (session_id, agency_id) references public.sessions(id, agency_id) on delete cascade
);

create table public.manager_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  session_id uuid not null,
  manager_id uuid not null references auth.users(id),
  note text not null check (length(note) between 1 and 2000),
  resolution text not null check (resolution in ('noted', 'coaching_planned', 'feedback_disputed', 'resolved')),
  report_id uuid,
  created_at timestamptz not null default now(),
  foreign key (session_id, agency_id) references public.sessions(id, agency_id) on delete cascade,
  foreign key (report_id, agency_id) references public.feedback_reports(id, agency_id) on delete set null (report_id)
);

-- ---------------------------------------------------------------- usage and cost

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  period_id uuid not null,
  session_id uuid,
  operation_id text not null unique,
  kind text not null check (kind in ('reservation', 'settlement', 'release', 'refund', 'adjustment')),
  seconds int not null,
  created_at timestamptz not null default now(),
  foreign key (period_id, agency_id) references public.usage_periods(id, agency_id)
  -- session_id intentionally not a FK: aggregate usage survives transcript retention deletion.
);
create index usage_ledger_agency_idx on public.usage_ledger(agency_id, created_at);

create table public.provider_attempts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  session_id uuid,
  turn_label text,
  operation_id text not null unique,
  operation text not null check (operation in ('stt', 'resident', 'tts', 'evaluate')),
  provider text not null check (provider in ('anthropic', 'deepgram', 'mock')),
  model text,
  state text not null check (state in ('in_flight', 'succeeded', 'failed', 'uncertain')),
  provider_request_id text,
  units jsonb,
  estimated_cost_minor bigint not null check (estimated_cost_minor >= 0),
  actual_cost_minor bigint check (actual_cost_minor is null or actual_cost_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cost_status text not null default 'estimated' check (cost_status in ('estimated', 'reconciled', 'unknown')),
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index provider_attempts_month_idx on public.provider_attempts(created_at);
create index provider_attempts_agency_idx on public.provider_attempts(agency_id, created_at);

create table public.audit_events (
  id bigint generated always as identity primary key,
  agency_id uuid references public.agencies(id) on delete cascade,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) < 2000),
  created_at timestamptz not null default now()
);
create index audit_events_agency_idx on public.audit_events(agency_id, created_at);

create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('my_transcripts', 'my_account')),
  note text check (note is null or length(note) <= 500),
  status text not null default 'requested' check (status in ('requested', 'completed', 'declined')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------- immutability guards
create or replace function app_private.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  -- Retention deletion runs as the table owner via app_private functions and is allowed to DELETE.
  if tg_op = 'DELETE' and current_setting('pitchready.retention', true) = 'on' then return old; end if;
  raise exception 'immutable_record' using detail = tg_table_name || ' rows cannot be changed', errcode = 'P0001';
end $$;

create trigger turns_immutable before update or delete on public.turns for each row execute function app_private.forbid_change();
create trigger corrections_immutable before update or delete on public.turn_corrections for each row execute function app_private.forbid_change();
create trigger evaluations_immutable before update or delete on public.evaluations for each row execute function app_private.forbid_change();
create trigger reviews_immutable before update or delete on public.manager_reviews for each row execute function app_private.forbid_change();
create trigger rubric_immutable before update or delete on public.rubric_versions for each row execute function app_private.forbid_change();
create trigger scenario_immutable before update or delete on public.scenario_versions for each row execute function app_private.forbid_change();

create or replace function app_private.published_campaign_frozen() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.state = 'published' and coalesce(current_setting('pitchready.retention', true), '') <> 'on' then
      raise exception 'immutable_record' using detail = 'published campaign versions cannot be deleted', errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.state = 'published' then
    raise exception 'immutable_record' using detail = 'published campaign versions are frozen', errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger campaign_frozen before update or delete on public.campaign_versions for each row execute function app_private.published_campaign_frozen();
