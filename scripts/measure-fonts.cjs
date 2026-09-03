const { PDFDocument, StandardFonts } = require('pdf-lib');
(async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const names = ['PROSPER NIYONKURU', 'EMMANUEL HAKIZIMANA', 'DIEUDONNE NIYOKWIZERA', 'OUMOROU FAROUKOU BOUKARI', 'BANGLADESH', 'SIERRA LEONE', 'ALAINCEDRIC MUGISHA', 'JEAN BOSCO NIYONKURU'];
  for (const n of names) console.log(n, '=>', font.widthOfTextAtSize(n, 10).toFixed(1), '| @9.5:', font.widthOfTextAtSize(n, 9.5).toFixed(1));
  console.log('Name col avail @pad3:', 0.211 * 507.28 - 6);
  console.log('Nat col avail @pad3:', 0.1422 * 507.28 - 6);
  console.log('Company col avail @pad3:', 0.3177 * 507.28 - 6, '| AL DARAA...:', font.widthOfTextAtSize('AL DARAA AL ARABI PLASTER & TILES CONT', 10).toFixed(1));
})();
