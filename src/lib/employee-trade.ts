import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// Employee Trade Helper
// ---------------------------------------------------------------------------
// Builds a Map<employeeId, { trade: string, hourlyRate: number }> from the
// EmployeeTrade junction table. Used by all rate-calculation code paths.
//
// Trade priority for rate calculation:
//   1. SalaryRecord trade (set by admin in Accounts) — HIGHEST priority
//   2. EmployeeTrade (assigned from Sites page) — uses TradeRate.hourlyRate
//   3. "Helper" (default) — uses threshold-based rates (2.5/5.0 or 3.0/5.5)
//
// If the trade is "Helper", the rate is determined by the threshold
// (below: 2.5/3.0, above: 5.0/5.5). For all other trades, the TradeRate
// hourlyRate is used for both below and above threshold.
// ---------------------------------------------------------------------------

export interface EmployeeTradeInfo {
  trade: string;
  hourlyRate: number | null; // null = use threshold-based rates (Helper)
  tradeRateId: string | null;
}

/**
 * Build a map of employeeId → EmployeeTradeInfo from the EmployeeTrade table.
 * Includes the TradeRate's trade name and hourlyRate.
 */
export async function buildEmployeeTradeMap(): Promise<Map<string, EmployeeTradeInfo>> {
  try {
    const assignments = await db.employeeTrade.findMany({
      include: {
        tradeRate: { select: { id: true, trade: true, hourlyRate: true } },
      },
    });

    const map = new Map<string, EmployeeTradeInfo>();
    for (const a of assignments) {
      const trade = a.tradeRate?.trade || 'Helper';
      const isHelper = trade.toLowerCase() === 'helper';
      map.set(a.employeeId, {
        trade,
        hourlyRate: isHelper ? null : (a.tradeRate?.hourlyRate ?? null),
        tradeRateId: a.tradeRateId,
      });
    }
    return map;
  } catch {
    // If EmployeeTrade table doesn't exist, return empty map
    return new Map();
  }
}

/**
 * Get the trade info for a single employee.
 */
export async function getEmployeeTrade(employeeId: string): Promise<EmployeeTradeInfo> {
  const map = await buildEmployeeTradeMap();
  return map.get(employeeId) || { trade: 'Helper', hourlyRate: null, tradeRateId: null };
}
