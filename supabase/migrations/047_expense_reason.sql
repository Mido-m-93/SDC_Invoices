-- Separates the RC経費精算 form's two free-text questions, which previously
-- both landed in `description`: the transportation route/reason (kept in
-- `description`) and the general expense reason (new `expense_reason`).
-- Run this in Supabase SQL Editor.

ALTER TABLE expense_claims
  ADD COLUMN IF NOT EXISTS expense_reason text NOT NULL DEFAULT '';
