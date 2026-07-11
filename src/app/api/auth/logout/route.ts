import { NextResponse } from 'next/server';

export async function POST() {
  // State is managed client-side; this endpoint just confirms logout
  return NextResponse.json({
    success: true,
    data: { message: 'Logged out successfully' },
  });
}
