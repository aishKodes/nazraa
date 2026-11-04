-- Additive management scope. Existing parents, balances and game settings remain unchanged.
ALTER TABLE platform_accounts MODIFY COLUMN role ENUM('MASTER','COUNTRY_MANAGER','SUPER_ADMIN','ADMIN','BD','AGENCY','COIN_SELLER','MONITORING_CS','GLOBAL_MANAGER') NOT NULL;
CREATE TABLE IF NOT EXISTS management_countries (
  code CHAR(2) PRIMARY KEY, name VARCHAR(100) NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO management_countries(code,name) VALUES
('IN','India'),('NP','Nepal'),('BT','Bhutan'),('BD','Bangladesh'),('LK','Sri Lanka'),('MV','Maldives'),('PK','Pakistan'),('AF','Afghanistan'),('MM','Myanmar'),('CN','China'),('NG','Nigeria'),('DZ','Algeria'),('MA','Morocco'),
('SA','Saudi Arabia'),('AE','United Arab Emirates'),('QA','Qatar'),('KW','Kuwait'),('BH','Bahrain'),('OM','Oman'),('YE','Yemen'),('IQ','Iraq'),('IR','Iran'),('JO','Jordan'),('LB','Lebanon'),('SY','Syria'),('PS','Palestine'),('IL','Israel'),('TR','Turkey'),('EG','Egypt'),('CY','Cyprus');
CREATE TABLE IF NOT EXISTS country_groups (
 id CHAR(36) PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE,
 version INT UNSIGNED NOT NULL DEFAULT 1, created_by CHAR(36) NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS country_group_countries (
 group_id CHAR(36) NOT NULL, country_code CHAR(2) NOT NULL, PRIMARY KEY(group_id,country_code),
 FOREIGN KEY(group_id) REFERENCES country_groups(id), FOREIGN KEY(country_code) REFERENCES management_countries(code)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS global_manager_country_groups (
 manager_id CHAR(36) NOT NULL, group_id CHAR(36) NOT NULL, PRIMARY KEY(manager_id,group_id),
 FOREIGN KEY(manager_id) REFERENCES platform_accounts(id), FOREIGN KEY(group_id) REFERENCES country_groups(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS global_manager_countries (
 manager_id CHAR(36) NOT NULL, country_code CHAR(2) NOT NULL, PRIMARY KEY(manager_id,country_code),
 FOREIGN KEY(manager_id) REFERENCES platform_accounts(id), FOREIGN KEY(country_code) REFERENCES management_countries(code)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS global_manager_assignments (
 manager_id CHAR(36) PRIMARY KEY, version INT UNSIGNED NOT NULL DEFAULT 0, game_reports_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY(manager_id) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;
-- Stable seed ID makes migration replay safe; membership is never overwritten after owner edits.
SET @nazraa_seed_middle_east = NOT EXISTS(SELECT 1 FROM country_groups WHERE id='1eadd1e0-0000-4000-8000-000000000017');
INSERT IGNORE INTO country_groups(id,name,active) VALUES ('1eadd1e0-0000-4000-8000-000000000017','Middle East',TRUE);
INSERT IGNORE INTO country_group_countries(group_id,country_code)
 SELECT '1eadd1e0-0000-4000-8000-000000000017', code FROM management_countries
 WHERE @nazraa_seed_middle_east AND code IN ('SA','AE','QA','KW','BH','OM','YE','IQ','IR','JO','LB','SY','PS','IL','TR','EG','CY');
