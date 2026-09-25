-- ScopeFlow — photos labelled for Xactimate.
--
-- The product now centres on getting photos into Xactimate quickly: every photo
-- carries a name (title) and a description, and rooms are often just names the
-- contractor tapped while shooting, measured later in Xactimate's sketch if at
-- all.

-- The photo's name, e.g. "Kitchen - Water line". The description already
-- exists as `caption`.
alter table public.photos add column if not exists title text;

-- A room may be only a name. The positive checks stay, so a dimension that is
-- recorded must still be real; NULL means "not measured".
alter table public.rooms alter column length_in drop not null;
alter table public.rooms alter column width_in drop not null;
alter table public.rooms alter column height_in drop not null;
