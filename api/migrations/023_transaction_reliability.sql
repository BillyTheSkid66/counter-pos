create table checkout_requests (
  organisation_id uuid not null references organisations(id),
  request_key uuid not null,
  user_id uuid not null references users(id),
  payload_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(organisation_id,request_key)
);
alter table checkout_requests enable row level security;
alter table checkout_requests force row level security;
create policy tenant_isolation on checkout_requests for all
  using(organisation_id=(select app_current_organisation_id()))
  with check(organisation_id=(select app_current_organisation_id()));
grant select,insert,update on checkout_requests to counter_app;

alter table payments add column till_session_id uuid;
alter table payments add constraint payments_session_tenant_fk foreign key(organisation_id,till_session_id) references till_sessions(organisation_id,id);
alter table payments add column original_payment_id uuid references payments(id);
alter table payments add column refund_id uuid;
alter table payments add constraint payments_refund_tenant_fk foreign key(organisation_id,refund_id) references refunds(organisation_id,id);
create index payments_session_idx on payments(organisation_id,till_session_id);
create index payments_original_idx on payments(original_payment_id);
-- Preserve the historical session attribution; new refunds use the current till.
update payments p set till_session_id=s.till_session_id from sales s where s.id=p.sale_id;
alter table refund_items drop constraint refund_items_amount_check;
alter table refund_items add constraint refund_items_amount_check check(amount>=0);
alter table refunds drop constraint refunds_total_check;
alter table refunds add constraint refunds_total_check check(total>=0);
