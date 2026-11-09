-- ScalaHosting/PostgreSQL administrator: NEW empty installation only.
-- Run once in psql as the PostgreSQL administrator; set passwords interactively.
\set ON_ERROR_STOP on
create role counter_app login nosuperuser nobypassrls nocreatedb nocreaterole;
create role counter_migrator login nosuperuser bypassrls nocreatedb nocreaterole;
\password counter_app
\password counter_migrator
create database counter owner counter_migrator;
\connect counter
create extension if not exists pgcrypto;
grant usage,create on schema public to counter_migrator;
grant execute on all functions in schema public to counter_migrator;
-- Use the migrator for migrations/backups only, never the API.
