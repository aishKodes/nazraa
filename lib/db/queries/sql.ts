import "server-only";

export const scopedAccountsSql = `
  WITH RECURSIVE descendants AS (
    SELECT id FROM platform_accounts WHERE id = ?
    UNION ALL
    SELECT account.id
    FROM platform_accounts account
    INNER JOIN descendants parent ON account.parent_account_id = parent.id
    WHERE account.status != 'DISABLED'
  )
  SELECT id FROM descendants
`;
