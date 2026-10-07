const express = require('express');
const { fail, num, str, oneOf } = require('../util');
const { requireRole } = require('../auth');
const reader = require('../meterReader');

// A photo of a pump's meter → the index read, which the form shows for the attendant to check.
// Nothing is saved here.
function meterRoutes() {
  const router = express.Router();

  router.post('/meters/read', requireRole('manager', 'attendant'), async (req, res) => {
    if (!reader.meterReaderEnabled()) fail(409, 'La lecture des photos n’est pas disponible.', 'no_reader');
    const image = String(req.body?.image || '');
    if (image.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(image)) fail(400, 'Photo illisible.');
    const mediaType = oneOf(req.body?.mediaType ?? 'image/jpeg', 'Le format de la photo', ['image/jpeg', 'image/png', 'image/webp']);
    const product = str(req.body?.product, 'Le produit', { required: false, max: 60 });
    const last = req.body?.last == null || req.body.last === '' ? null : num(req.body.last, 'Le dernier index', { max: 1e12 });
    let index;
    try {
      index = await reader.readMeter({ image, mediaType, product, last });
    } catch (err) {
      console.error('Lecture du compteur :', err.message);
      fail(422, 'Lecture impossible : tapez l’index.', 'reader_failed');
    }
    if (index == null) fail(422, 'Index illisible : reprenez la photo ou tapez-le.', 'unreadable');
    res.json({ index });
  });

  return router;
}

module.exports = meterRoutes;
