-- Preserve each existing shared game's total cadence while giving its
-- authoritative result enough visible time to complete the deterministic
-- client animation. Because total cycle lengths stay unchanged, round-number
-- boundaries and any in-flight settled rounds are not remapped.
--
-- Only upgrade the known previous production values. A Master-customized
-- timing remains untouched and can be changed from Settings → Game controls.
UPDATE system_settings
SET setting_value = JSON_SET(
  setting_value,
  '$.games.teen_patti_pro.bettingSeconds', 11,
  '$.games.teen_patti_pro.drawingSeconds', 3,
  '$.games.teen_patti_pro.resultSeconds', 5,
  '$.games.luck77.bettingSeconds', 7,
  '$.games.luck77.drawingSeconds', 1,
  '$.games.luck77.resultSeconds', 5,
  '$.games.greedy_lion.bettingSeconds', 14,
  '$.games.greedy_lion.drawingSeconds', 3,
  '$.games.greedy_lion.resultSeconds', 5,
  '$.games.greedy_king.bettingSeconds', 22,
  '$.games.greedy_king.drawingSeconds', 3,
  '$.games.greedy_king.resultSeconds', 5
)
WHERE setting_key = 'mobile.games'
  AND JSON_VALID(setting_value)
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.teen_patti_pro.bettingSeconds')) = '12'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.teen_patti_pro.drawingSeconds')) = '4'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.teen_patti_pro.resultSeconds')) = '3'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.luck77.bettingSeconds')) = '8'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.luck77.drawingSeconds')) = '2'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.luck77.resultSeconds')) = '3'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.greedy_lion.bettingSeconds')) = '16'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.greedy_lion.drawingSeconds')) = '3'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.greedy_lion.resultSeconds')) = '3'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.greedy_king.bettingSeconds')) = '24'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.greedy_king.drawingSeconds')) = '3'
  AND JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.games.greedy_king.resultSeconds')) = '3';
