// Local integration check. Run inside the backend container after deployment.
// Creates and removes its own unpublished event; existing event data is not edited.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { JwtService } = require('@nestjs/jwt');
const { defaultCertificateDesign } = require('../dist/src/events/certificate-design.js');
const prisma = new PrismaClient();

(async () => {
  let eventId, athleteId;
  try {
    const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true } });
    const category = await prisma.category.findFirstOrThrow();
    const country = await prisma.country.findFirstOrThrow();
    const athlete = await prisma.athlete.create({ data: { firstName: 'Kiểm thử', lastName: 'Chứng nhận', fullName: 'VĐV kiểm thử chứng nhận', gender: 'MALE', countryId: country.id, categories: { connect: { id: category.id } } } });
    athleteId = athlete.id;
    const event = await prisma.event.create({ data: { name: 'Certificate integration fixture', sportId: category.sportId, startDate: new Date('2026-10-01'), endDate: new Date('2026-10-03'), athletes: { connect: { id: athlete.id } }, categories: { connect: { id: category.id } } } });
    eventId = event.id;
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: admin.id, sessionIssuedAt: Date.now() }, { expiresIn: '5m' });
    const base = `http://127.0.0.1:4000/api/events/${eventId}/certificates`;
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(base)).status, 401);
    let response = await fetch(base, { headers }); assert.equal(response.status, 200);
    assert.equal((await response.json()).design.orientation, 'portrait');
    response = await fetch(`${base}/recipients`, { headers }); assert.equal(response.status, 200);
    const recipients = await response.json(); assert.equal(recipients.length, 1); assert.equal(recipients[0].athleteName, athlete.fullName);
    const design = defaultCertificateDesign(); design.awards[recipients[0].id] = 'Huy chương Vàng'; design.offsetX = 1.5;
    // Exercise the event-scoped request size for large competitions (>100 KB).
    for (let index = 0; index < 300; index++) design.awards[`fixture-${index}`] = 'A'.repeat(500);
    response = await fetch(base, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ design }) }); assert.equal(response.status, 200, await response.text());
    response = await fetch(base, { headers }); assert.deepEqual((await response.json()).design, design);
    const invalid = { ...design, offsetX: 30 };
    assert.equal((await fetch(base, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ design: invalid }) })).status, 400);
    const publicEvent = await (await fetch(`http://127.0.0.1:4000/api/events/${eventId}`)).json();
    assert.equal(publicEvent.certificateDesign, undefined); assert.equal(publicEvent.certificateBackgroundStorageKey, undefined);
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tEAAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'test.png');
    response = await fetch(`${base}/background`, { method: 'PATCH', headers, body: form }); assert.equal(response.status, 200, await response.text());
    assert.equal((await fetch(`${base}/background`)).status, 401);
    response = await fetch(`${base}/background`, { headers }); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/); assert.ok((await response.arrayBuffer()).byteLength > 0);
    response = await fetch(`${base}/background`, { method: 'DELETE', headers }); assert.equal(response.status, 200);
    assert.equal((await fetch(`${base}/background`, { headers })).status, 404);
    console.log('PASS: authenticated APIs, persisted layout and award text, recipient scope, invalid layout rejection, private background upload/read/delete, no certificate data in public event response.');
  } finally {
    if (eventId) {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { certificateBackgroundStorageKey: true } });
      if (event?.certificateBackgroundStorageKey) console.error('Warning: test background remains in storage; remove before cleanup.');
      await prisma.event.delete({ where: { id: eventId } });
    }
    if (athleteId) await prisma.athlete.delete({ where: { id: athleteId } });
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
