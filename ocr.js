// Lectura local del ticket: sharp prepara la foto y Tesseract (en español) la lee.
// Nada sale de la máquina.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { leerTicket } from './parser.js';

const TESSDATA = process.env.TESSDATA_DIR; // opcional; el Dockerfile lo apunta al modelo de tessdata/

function tesseract(png, psm) {
  return new Promise((resolve, reject) => {
    const args = ['stdin', 'stdout', '-l', 'spa', '--psm', String(psm)];
    if (TESSDATA) args.push('--tessdata-dir', TESSDATA);
    const p = spawn('tesseract', args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err || `tesseract ${code}`))));
    p.stdin.end(png);
  });
}

function puntos(r) {
  return (r.cents ? 4 : 0) + (r.seguro.total ? 3 : 0) + (r.seguro.fecha ? 1 : 0) + (r.seguro.comercio ? 1 : 0);
}

const PYTHON = process.env.PYTHON || 'python3';
const ESCANER = fileURLToPath(new URL('./escanear.py', import.meta.url));

function ejecutar(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err || `${cmd} ${c}`))));
  });
}

// Escanea la foto (papel, perspectiva, luz, enderezado) y lee dos versiones con dos modos de página.
// Se queda con la lectura que más entiende. Las imágenes temporales se borran al terminar.
export async function leerFoto(buffer, hoy = new Date()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-'));
  try {
    const entrada = path.join(dir, 'foto.jpg');
    fs.writeFileSync(entrada, await sharp(buffer).rotate().jpeg({ quality: 95 }).toBuffer());
    const gris = path.join(dir, 'gris.png');
    const bn = path.join(dir, 'bn.png');
    await ejecutar(PYTHON, [ESCANER, entrada, gris, bn]);
    let mejor = null;
    for (const [img, psm] of [[bn, 4], [gris, 4], [bn, 6], [gris, 6]]) {
      const texto = await tesseract(fs.readFileSync(img), psm);
      const r = { ...leerTicket(texto, hoy), texto, psm, version: path.basename(img, '.png') };
      if (!mejor || puntos(r) > puntos(mejor)) mejor = r;
      if (r.cents && r.seguro.total && r.seguro.fecha && r.seguro.comercio) break;
    }
    return mejor;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
