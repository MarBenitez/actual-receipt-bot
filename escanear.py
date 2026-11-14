"""Escáner de tickets: encuentra el papel en la foto, lo aplana y prepara dos versiones para Tesseract.

Uso: python escanear.py foto.jpg salida_gris.png salida_bn.png
Método clásico de las apps de escanear: bordes del papel -> perspectiva -> luz igualada -> binarizado por zonas.
"""
import sys

import cv2
import numpy as np


def ordenar(pts):
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype="float32")


def aplanar(img, pts):
    tl, tr, br, bl = ordenar(pts)
    w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype="float32")
    m = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl]), dst)
    return cv2.warpPerspective(img, m, (w, h))


def igualar_luz(gris):
    # El fondo de la hoja (sin la tinta) se estima con un cierre morfológico grande y se divide.
    fondo = cv2.morphologyEx(gris, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)))
    fondo = cv2.GaussianBlur(fondo, (0, 0), 5)
    plana = cv2.divide(gris, fondo, scale=255)
    return cv2.normalize(plana, None, 0, 255, cv2.NORM_MINMAX)


def buscar_papel(gris):
    area_foto = gris.shape[0] * gris.shape[1]
    plana = igualar_luz(cv2.GaussianBlur(gris, (0, 0), 3))
    # El papel es la zona clara y grande; la tinta se tapa con un cierre para que salga un bloque.
    _, mascara = cv2.threshold(cv2.GaussianBlur(gris, (0, 0), 9), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    candidatos = []
    for fuente in (mascara, cv2.dilate(cv2.Canny(cv2.GaussianBlur(gris, (0, 0), 3), 30, 90), None, iterations=3)):
        cs, _ = cv2.findContours(fuente, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in sorted(cs, key=cv2.contourArea, reverse=True)[:5]:
            a = cv2.contourArea(c)
            if a < area_foto * 0.08 or a > area_foto * 0.95:
                continue
            aprox = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
            pts = aprox.reshape(-1, 2) if len(aprox) == 4 else cv2.boxPoints(cv2.minAreaRect(c))
            candidatos.append((a, pts.astype("float32")))
    del plana
    if not candidatos:
        return None
    return max(candidatos, key=lambda x: x[0])[1]


def enderezar(plana, bn):
    """Gira según las líneas de texto y recorta a la tinta."""
    tinta = 255 - bn
    tinta = cv2.morphologyEx(tinta, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))  # fuera puntitos sueltos
    # Las líneas de texto, unidas en barras horizontales, dan el ángulo con más fiabilidad que píxeles sueltos.
    barras = cv2.dilate(tinta, cv2.getStructuringElement(cv2.MORPH_RECT, (45, 3)))
    cs, _ = cv2.findContours(barras, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    angulos = []
    for c in cs:
        (_, _), (w, h), a = cv2.minAreaRect(c)
        if w < h:
            w, h, a = h, w, a - 90
        if w > 150 and w > 4 * h:
            angulos.append(a)
    if angulos:
        a = float(np.median(angulos))
        if 0.5 < abs(a) < 20:
            alto, ancho = plana.shape
            m = cv2.getRotationMatrix2D((ancho / 2, alto / 2), a, 1)
            plana = cv2.warpAffine(plana, m, (ancho, alto), borderValue=255)
            bn = cv2.warpAffine(bn, m, (ancho, alto), borderValue=255)
            tinta = cv2.warpAffine(tinta, m, (ancho, alto), borderValue=0)
    ys, xs = np.where(cv2.morphologyEx(tinta, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0)
    if len(xs) > 500:
        x0, x1 = np.percentile(xs, [0.5, 99.5]).astype(int)
        y0, y1 = np.percentile(ys, [0.5, 99.5]).astype(int)
        mg = 30
        y0, x0 = max(0, y0 - mg), max(0, x0 - mg)
        plana, bn = plana[y0:y1 + mg, x0:x1 + mg], bn[y0:y1 + mg, x0:x1 + mg]
        if plana.shape[1] < 1400:
            f = 1800 / plana.shape[1]
            plana = cv2.resize(plana, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
            bn = cv2.threshold(cv2.resize(bn, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC), 128, 255, cv2.THRESH_BINARY)[1]
    return plana, bn


def main(entrada, salida_gris, salida_bn):
    img = cv2.imread(entrada)
    escala = 1600 / max(img.shape[:2])
    if escala < 1:
        img = cv2.resize(img, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    pts = buscar_papel(gris)
    hoja = aplanar(gris, pts) if pts is not None else gris
    if hoja.shape[1] > hoja.shape[0] * 1.3:  # tumbado: el ticket es más alto que ancho
        hoja = cv2.rotate(hoja, cv2.ROTATE_90_CLOCKWISE)
    hoja = cv2.resize(hoja, None, fx=1800 / hoja.shape[1], fy=1800 / hoja.shape[1], interpolation=cv2.INTER_CUBIC)
    plana = igualar_luz(cv2.fastNlMeansDenoising(hoja, None, 12, 7, 21))
    bn = cv2.adaptiveThreshold(plana, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 15)
    plana, bn = enderezar(plana, bn)
    cv2.imwrite(salida_gris, plana)
    cv2.imwrite(salida_bn, bn)
    print("papel" if pts is not None else "sin-papel")


if __name__ == "__main__":
    main(*sys.argv[1:4])
