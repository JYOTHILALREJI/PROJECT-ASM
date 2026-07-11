import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/accounts/sites-for-month?month=YYYY-MM&year=YYYY
// Returns all sites that have activity (salary records or employee assignments) for the given month/year
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month'); // YYYY-MM
    const yearStr = searchParams.get('year');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'month (YYYY-MM) query parameter is required' },
        { status: 400 }
      );
    }

    const yearNum = yearStr ? parseInt(yearStr, 10) : parseInt(month.split('-')[0], 10);

    // Source 1: Sites with salary records for this month/year
    const salarySites = await db.salaryRecord.findMany({
      where: { month, year: yearNum, isDeleted: false },
      select: { siteId: true, siteName: true },
      distinct: ['siteId'],
    });

    // Source 2: Sites with employee assignments via EmpCountSitePerMonth
    const empCountSites = await db.empCountSitePerMonth.findMany({
      where: { month, deletedDate: null },
      select: { siteId: true, siteName: true },
      distinct: ['siteId'],
    });

    // Source 3: Sites activated for this month/year via SiteMonthActivation
    const activatedSites = await db.siteMonthActivation.findMany({
      where: { month, year: yearNum },
      select: { siteId: true },
      distinct: ['siteId'],
    });

    // Merge all sources into a unique set of site IDs
    const siteMap = new Map<string, string>();

    for (const s of salarySites) {
      siteMap.set(s.siteId, s.siteName);
    }
    for (const s of empCountSites) {
      if (!siteMap.has(s.siteId)) {
        siteMap.set(s.siteId, s.siteName);
      }
    }

    // For activated sites, we need to fetch the site name
    const activatedSiteIds = activatedSites
      .map(s => s.siteId)
      .filter(id => !siteMap.has(id));

    if (activatedSiteIds.length > 0) {
      const sites = await db.site.findMany({
        where: { id: { in: activatedSiteIds } },
        select: { id: true, name: true },
      });
      for (const s of sites) {
        siteMap.set(s.id, s.name);
      }
    }

    // Fetch full site details for all unique site IDs
    const allSiteIds = Array.from(siteMap.keys());
    let sitesWithDetails: Array<{ id: string; name: string; clientName: string | null; projectName: string | null; employeeCount: number }> = [];

    if (allSiteIds.length > 0) {
      const siteRecords = await db.site.findMany({
        where: { id: { in: allSiteIds } },
        select: { id: true, name: true, clientName: true, projectName: true },
      });

      // Get employee count per site for this month from salary records
      const salaryCounts = await db.salaryRecord.groupBy({
        by: ['siteId'],
        where: { month, year: yearNum, isDeleted: false },
        _count: { empId: true },
      });

      const countMap = new Map(salaryCounts.map(s => [s.siteId, s._count.empId]));

      // Also check EmpCountSitePerMonth for counts
      const empCountRecords = await db.empCountSitePerMonth.groupBy({
        by: ['siteId'],
        where: { month, deletedDate: null },
        _count: { empId: true },
      });

      const empCountMap = new Map(empCountRecords.map(s => [s.siteId, s._count.empId]));

      sitesWithDetails = siteRecords.map(s => ({
        id: s.id,
        name: s.name,
        clientName: s.clientName,
        projectName: s.projectName,
        employeeCount: Math.max(countMap.get(s.id) || 0, empCountMap.get(s.id) || 0),
      }));

      // Sort by name
      sitesWithDetails.sort((a, b) => a.name.localeCompare(b.name));
    }

    return NextResponse.json({
      success: true,
      data: { sites: sitesWithDetails },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[sites-for-month GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
