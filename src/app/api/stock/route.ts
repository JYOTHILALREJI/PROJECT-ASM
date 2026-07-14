import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';

// ---------------------------------------------------------------------------
// /api/stock
// ---------------------------------------------------------------------------
// GET  — list all stock items (optionally filtered by itemName)
// POST — create or add quantity to a stock item (upsert by itemName + size)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const itemName = sp.get('itemName');

    const where: Record<string, unknown> = { deletedAt: null };
    if (itemName) where.itemName = itemName;

    const items = await db.stockItem.findMany({
      where,
      orderBy: [{ itemName: 'asc' }, { size: 'asc' }],
    });

    return NextResponse.json({
      success: true,
      data: {
        stockItems: items.map((i) => ({
          id: i.id,
          itemName: i.itemName,
          size: i.size,
          quantity: i.quantity,
          minQuantity: i.minQuantity,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { itemName, size, quantity, minQuantity, actorUserId, actorDisplayName } = body;

    if (!itemName || typeof itemName !== 'string' || itemName.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'itemName is required' },
        { status: 400 },
      );
    }

    const trimmedName = itemName.trim();
    const trimmedSize = typeof size === 'string' && size.trim() ? size.trim() : null;
    const addQty = typeof quantity === 'number' && quantity > 0 ? quantity : 0;
    const minQty = typeof minQuantity === 'number' && minQty >= 0 ? minQuantity : 0;

    // Upsert: if (itemName, size) already exists, add to quantity. Otherwise create.
    const existing = await db.stockItem.findFirst({
      where: { itemName: trimmedName, size: trimmedSize, deletedAt: null },
    });

    let item;
    if (existing) {
      item = await db.stockItem.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + addQty,
          minQuantity: minQty || existing.minQuantity,
        },
      });
    } else {
      item = await db.stockItem.create({
        data: {
          itemName: trimmedName,
          size: trimmedSize,
          quantity: addQty,
          minQuantity: minQty,
        },
      });
    }

    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin',
      action: 'stock_add',
      entityType: 'stock_item',
      entityId: item.id,
      entityName: `${item.itemName}${item.size ? ` (${item.size})` : ''}`,
      description: `Added ${addQty}x ${item.itemName}${item.size ? ` size ${item.size}` : ''} to stock. New total: ${item.quantity}`,
      request,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT — update a stock item (set quantity, minQuantity, etc.)
// ---------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, quantity, minQuantity, actorUserId, actorDisplayName } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 },
      );
    }

    const existing = await db.stockItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Stock item not found' },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof quantity === 'number') updateData.quantity = quantity;
    if (typeof minQuantity === 'number') updateData.minQuantity = minQuantity;

    const item = await db.stockItem.update({
      where: { id },
      data: updateData,
    });

    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin',
      action: 'stock_update',
      entityType: 'stock_item',
      entityId: item.id,
      entityName: `${item.itemName}${item.size ? ` (${item.size})` : ''}`,
      description: `Updated stock for ${item.itemName}${item.size ? ` (${item.size})` : ''}. Quantity: ${item.quantity}`,
      request,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — soft-delete a stock item
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 },
      );
    }

    const existing = await db.stockItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Stock item not found' },
        { status: 404 },
      );
    }

    await db.stockItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
