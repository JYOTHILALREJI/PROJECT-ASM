/* Standalone test of the NOC PDF generator — replicates the PROSCAPE ARABIAN RANCHES reference. */
const { generateNocPdf, buildNocFileName } = require('./.compiled/noc-pdf.js');

async function main() {
  const rows20 = [
    ['PACIFIQUE IRUMVA', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00032399'],
    ['PROSPER CIZA', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'OP0316316'],
    ['PROSPER NIYONKURU', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00041935'],
    ['JEAN BOSCO NIYONKURU', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00044291'],
    ['FABRICE NZOYISABA', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00094590'],
    ['MOHAMMAD AL AMIN MOKHLES KHAN', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BANGLADESH', 'EG0410056'],
    ['GILBERT KAMATARI', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'OP0337904'],
    ['ERNESTE NDIKUMANA', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00010641'],
    ['GASTON VYIZIGIRO', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00173765'],
    ['TOUSSAINT BIZIMANA', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'P00033303'],
    ['EMMANUEL HAKIZIMANA', 'HELPER', 'AL DARAA AL ARABI PLASTER & TILES CONT', 'BURUNDI', 'OP0276516'],
    ['VEDASTE NGENDAKUMANA', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'P00179109'],
    ['THIERRY SINZUMUNSI', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'P00145864'],
    ['DIEUDONNE NIYOKWIZERA', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'P00153292'],
    ['EMMERY NAHAYO', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'OP0224098'],
    ['ALAINCEDRIC MUGISHA', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'P00177871'],
    ['DIEUDONNE TUYISENGE', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'P00131653'],
    ['IGNACE NZAMBIMANA', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'BURUNDI', 'P00154137'],
    ['OUMOROU FAROUKOU BOUKARI', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'TOGO', 'EB640238'],
    ['MALIK OKOUTO KRO', 'HELPER', 'ARABIAN SHIELD A/C UNITS FIX CONT', 'TOGO', 'EB631222'],
  ].map(([name, trade, company, nationality, passport]) => ({ name, trade, company, nationality, passport }));

  const data = {
    clientName: 'M/S PROSCAPE LLC',
    projectName: 'ARABIAN RANCHES',
    clientAddress: 'Business Bay-Bay Square\nDubai, UAE',
    nocDate: '02-09-2026',
    contactPerson: 'Ms. Mafeeda Kader',
    contactPhone: '050 797 4153',
    contactEmail: 'mafeedaarabianshieldmanpower@gmail.com',
    stampType: 'procurement',
    employees: rows20,
  };

  const bytes = await generateNocPdf(data);
  require('fs').writeFileSync('/home/z/my-project/scripts/test-noc-20.pdf', bytes);
  console.log('20-row NOC written, bytes:', bytes.length, '| filename:', buildNocFileName(data));

  // 10-row case (should fit signature on the same page)
  const bytes10 = await generateNocPdf({ ...data, projectName: 'DAMAC LAGOON', nocDate: '03-09-2026', employees: rows20.slice(0, 10) });
  require('fs').writeFileSync('/home/z/my-project/scripts/test-noc-10.pdf', bytes10);
  console.log('10-row NOC written, bytes:', bytes10.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
