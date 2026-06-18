-- Phase 9: Outbound Invoices — Google Drive columns (additive patch on top of 002)
-- Migration 002 is authoritative for the outbound_invoices schema.
-- This migration adds the Google Drive tracking columns that were in the original
-- standalone 004 script, without conflicting with the 002 schema.

alter table outbound_invoices
  add column if not exists drive_file_id  text not null default '',
  add column if not exists drive_file_url text not null default '';
