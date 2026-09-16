-- Migration for databases created before Moni/WL giveaway fields existed.
-- Run only once against old databases. New databases should use schema.sql.
ALTER TABLE tweets ADD COLUMN moni_score INTEGER;
ALTER TABLE tweets ADD COLUMN wl_spots INTEGER;
ALTER TABLE tweets ADD COLUMN follower_count INTEGER;
ALTER TABLE tweets ADD COLUMN link_risk_level TEXT;
ALTER TABLE tweets ADD COLUMN link_risk_score INTEGER;
ALTER TABLE tweets ADD COLUMN link_risk_reasons TEXT;
ALTER TABLE tweets ADD COLUMN is_giveaway INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN is_raffle INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN is_wl_giveaway INTEGER DEFAULT 0;
ALTER TABLE tweets ADD COLUMN is_wl_raffle INTEGER DEFAULT 0;
