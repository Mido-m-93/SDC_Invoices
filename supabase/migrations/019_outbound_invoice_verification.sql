-- AI consistency verification storage for client (outbound) invoices.
-- Run this in Supabase SQL Editor.

alter table outbound_invoices
  add column if not exists verification jsonb;
