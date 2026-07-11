import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json(
        { success: false, error: 'siteId query parameter is required' },
        { status: 400 }
      );
    }

    // Find the site to determine if it's active and get closed date info
    const site = await db.site.findUnique({
      where: { id: siteId },
    });

    if (!site) {
      return NextResponse.json(
        { success: false, error: 'Site not found' },
        { status: 404 }
      );
    }

    const siteClosedDate = !site.isActive ? site.createdAt.toISOString() : null;

    // Get all EmpCountSitePerMonth records for this site where deletedDate is null
    const records = await db.empCountSitePerMonth.findMany({
      where: {
        siteId,
        deletedDate: null,
      },
      include: {
        employee: {
          select: {
            employeeId: true,
          },
        },
      },
      orderBy: [
        { empName: 'asc' },
        { createdDate: 'asc' },
      ],
    });

    const formattedRecords = records.map((record) => ({
      id: record.id,
      empId: record.empId,
      empName: record.empName,
      employeeId: record.employee.employeeId,
      siteId: record.siteId,
      siteName: record.siteName,
      month: record.month,
      createdDate: record.createdDate.toISOString(),
      removedDate: record.removedDate ? record.removedDate.toISOString() : null,
      updatedDate: record.updatedDate.toISOString(),
      deletedDate: record.deletedDate ? record.deletedDate.toISOString() : null,
      siteClosedDate,
    }));

    return NextResponse.json({
      success: true,
      data: {
        records: formattedRecords,
        siteClosedDate,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
