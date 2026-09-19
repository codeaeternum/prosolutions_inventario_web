#!/usr/bin/env python3
"""Importador TallerControl → Reficio (piloto).

Genera SQL idempotente desde el xlsx exportado de TallerControl:
  - Limpia capitalización, typos de marca/modelo y texto libre.
  - Crea las 2 sucursales del taller (Maneadero + Cañon Buenavista) y los
    recepcionistas como usuarios EMPLOYEE del tenant piloto.
  - Mapea estados, dinero y fechas al dominio actual sin inventar datos:
    teléfonos quedan vacíos (linkCustomerByPhone ignora <7 dígitos),
    customerId queda NULL, refacciones van como texto en diagnosis.
  - Conserva folio original en `number` y raw en el evento de recepción.

Uso: python3 scripts/import-tallercontrol.py <xlsx> <out.sql> <report.json>
"""
import json
import re
import sys
from datetime import datetime, timedelta
from collections import Counter

import openpyxl

BUSINESS_ID = "biz-default"
BRANCH_MAIN = "branch-maneadero"
BRANCH_CB = "branch-canbuenavista"
# Receptor por defecto cuando "Usuario recibio" viene vacío o no mapea:
# el script crea a Cristina en ambos entornos, así que es FK seguro.
FALLBACK_ACTOR = "imp-staff-cristina"

STAFF = {
    "cristina solorio lopez": ("imp-staff-cristina", "Cristina Solorio Lopez"),
    "kevin": ("imp-staff-kevin", "Kevin"),
    "diego alvarez liera": ("imp-staff-diego", "Diego Alvarez Liera"),
    "isabel luna": ("imp-staff-isabel", "Isabel Luna"),
    "aranza avalos": ("imp-staff-aranza", "Aranza Avalos"),
    "christian": ("imp-staff-christian", "Christian"),
}

STATUS_MAP = {
    "entregado": "DELIVERED",
    "cancelado": "CANCELLED",
    "no quedó": "NOT_REPAIRED",
    "no quedo": "NOT_REPAIRED",
    "reparado": "READY",
    "reparación": "IN_REPAIR",
    "reparacion": "IN_REPAIR",
    "esperando autorización": "WAITING_APPROVAL",
    "esperando autorizacion": "WAITING_APPROVAL",
    "no autorizado": "NOT_AUTHORIZED",
    "laboratorio": "EXTERNAL_LAB",
}
STATUS_LABEL = {
    "DELIVERED": "Entregado",
    "CANCELLED": "Cancelado",
    "NOT_REPAIRED": "No reparado",
    "READY": "Reparado — listo para entrega",
    "IN_REPAIR": "En reparación",
    "WAITING_APPROVAL": "Esperando autorización",
    "NOT_AUTHORIZED": "No autorizado",
    "EXTERNAL_LAB": "Laboratorio externo",
}
NO_REPAIR = {"NOT_REPAIRED", "NOT_AUTHORIZED"}

# Palabras que en la columna "Marca" son tipo de equipo, no marca.
EQUIP_WORDS = {
    "tablet": "Tablet", "tab": "Tablet", "tableta": "Tablet",
    "bocina": "Bocina", "bocinas": "Bocina",
    "computadora": "Computadora", "pc": "Computadora", "laptop": "Laptop",
    "control": "Control remoto", "dron": "Drone", "drone": "Drone",
    "celular": "Celular", "telefono": "Celular",
}
JUNK = {"x", "xx", "t", "on", "na", "n/a", "no dice", "chino", "s/n", "red",
        "no", "-", "--", "0", "sn", "sin imei", "desconocido", "generico", ""}

# (regex sobre la celda de marca en minúsculas, marca canónica)
BRAND_RULES = [
    (r"samsu|samsumg|samnsung|samsunh|sasung|samsing|samsng|samsun\b", "Samsung"),
    (r"iphone|ipad|ipod|mac\b|macbook|imac|airpods|apple|\bipa\b", "Apple"),
    (r"motorola|motorla|\bmoto\b", "Motorola"),
    (r"redmi|redni|readmi|poco|xiaomi|xioami|naomi", "Xiaomi"),
    (r"huawei", "Huawei"), (r"honor", "Honor"),
    (r"0ppo|oppo", "Oppo"), (r"vivo|vivio|vivoo", "Vivo"),
    (r"\bzte\b|axon", "ZTE"), (r"\blg\b", "LG"),
    (r"google|gogle|pixel", "Google"), (r"alcatel", "Alcatel"),
    (r"realme", "Realme"), (r"\btcl\b", "TCL"), (r"nokia", "Nokia"),
    (r"sony|playstation|ps[2-5]", "Sony"), (r"one ?plus", "OnePlus"),
    (r"hisense", "Hisense"), (r"infinix|infiniti", "Infinix"),
    (r"tecno", "Tecno"), (r"hp\b|hpp", "HP"), (r"dell", "Dell"),
    (r"lenovo", "Lenovo"), (r"asus", "Asus"), (r"acer", "Acer"),
    (r"toshiba", "Toshiba"), (r"msi", "MSI"), (r"compaq", "Compaq"),
    (r"nintendo", "Nintendo"), (r"xbox", "Microsoft"),
    (r"zuum|zumm|zunn", "Zuum"), (r"cubot", "Cubot"),
    (r"wiko", "Wiko"), (r"vortex", "Vortex"), (r"maxwest", "Maxwest"),
    (r"doogge|doogee", "Doogee"), (r"oukitel", "Oukitel"),
    (r"nubia", "Nubia"), (r"revvl", "REVVL"), (r"hot ?peper|hot ?pepper", "Hot Pepper"),
    (r"blu\b|blue", "BLU"), (r"hyindai|hyundai", "Hyundai"),
    (r"cloud|clou\b", "Cloud"), (r"ablegrid", "Ablegrid"),
    (r"amazon", "Amazon"), (r"rca", "RCA"), (r"sky\b", "Sky"),
    (r"bison", "Bison"), (r"kaiser", "Kaiser"), (r"htc", "HTC"),
    (r"at&t|att", "AT&T"), (r"philips", "Philips"), (r"sharp", "Sharp"),
    (r"panasonic", "Panasonic"), (r"jvc", "JVC"), (r"vizio", "Vizio"),
    (r"insignia", "Insignia"), (r"sanyo", "Sanyo"), (r"hitachi", "Hitachi"),
    (r"atvio", "Atvio"), (r"daewoo", "Daewoo"), (r"lanix", "Lanix"),
    (r"nyx", "NYX"), (r"whirlpool", "Whirlpool"), (r"mabe", "Mabe"),
    (r"pcd", "PCD"), (r"bjl", "BJL"), (r"kanji", "Kanji"),
]
LAPTOP_BRANDS = {"HP", "Dell", "Lenovo", "Asus", "Acer", "Toshiba", "MSI", "Compaq"}
TV_BRANDS = {"RCA", "Atvio", "Daewoo", "Element", "Insignia", "Sanyo", "Hitachi", "JVC", "Vizio"}
TYPO = {"viruz": "virus", "fon": "phone", "contrasena": "contraseña", "senal": "señal",
        "windous": "windows", "bateria": "batería", "fotmateo": "formateo", "arreglo": "arreglo"}
MODEL_WORDS = {"iphone": "iPhone", "ipad": "iPad", "ipod": "iPod", "macbook": "MacBook",
               "airpods": "AirPods", "imac": "iMac", "galaxy": "Galaxy", "moto": "Moto",
               "redmi": "Redmi", "poco": "Poco", "xr": "XR", "xs": "XS", "se": "SE",
               "note": "Note", "pro": "Pro", "max": "Max", "plus": "Plus", "mini": "Mini",
               "ultra": "Ultra", "lite": "Lite", "edge": "Edge", "fold": "Fold",
               "flip": "Flip", "play": "Play", "power": "Power", "x": "X"}
PARTICLES = {"de", "del", "la", "las", "los", "y"}


def norm_ws(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def title_case(s, particles=True):
    out = []
    for i, w in enumerate(s.split()):
        lw = w.lower()
        if particles and i > 0 and lw in PARTICLES:
            out.append(lw)
        elif lw in MODEL_WORDS:
            out.append(MODEL_WORDS[lw])
        elif re.search(r"\d", w):
            out.append(w.upper())
        elif len(w) <= 2 and w.isupper():
            out.append(w)
        else:
            out.append(w[0].upper() + w[1:].lower() if w else w)
    return " ".join(out)


def clean_person(s):
    s = norm_ws(s)
    return title_case(s) if s else None


def clean_text(s):
    """Descripciones libres: colapsa espacios, pasa ALL-CAPS a sentence case,
    corrige typos evidentes. Conserva texto mixto tal cual."""
    s = norm_ws(s)
    if not s:
        return None
    if s.isupper():
        s = s.lower()
        s = " ".join(TYPO.get(w, w) for w in s.split())
        s = s[0].upper() + s[1:]
    elif s.islower():
        s = " ".join(TYPO.get(w, w) for w in s.split())
        s = s[0].upper() + s[1:]
    return s


def map_brand(raw_brand, raw_model):
    """Devuelve (brand, model_from_brand, equip_type_hint)."""
    b = norm_ws(raw_brand).lower()
    m = norm_ws(raw_model)
    if not b or b in JUNK:
        b_model = None if m.lower() in JUNK else m
        # A veces el modelo trae la marca ("samsing", "rca", "hpp").
        for pat, name in BRAND_RULES:
            if re.search(pat, m.lower()):
                return name, None, None
        return None, b_model, None
    if b in EQUIP_WORDS:
        hint = EQUIP_WORDS[b]
        for pat, name in BRAND_RULES:
            if re.search(pat, m.lower()):
                return name, None if m.lower() in JUNK else m, hint
        return None, None if m.lower() in JUNK else m, hint
    # Multi-marca ("moto samsung y honor"): primer token que matchee.
    brand, leftover = None, ""
    for pat, name in BRAND_RULES:
        hit = re.search(pat, b)
        if hit:
            brand = name
            leftover = norm_ws(b[hit.end():])
            break
    if brand is None:
        brand = title_case(b)
    # Casos "iphone 8", "redmi 9t", "samsunga22", "a06", "xr", "11 pro max".
    if brand in ("Apple", "Xiaomi", "Samsung") or re.fullmatch(r"[a-z]?\d+.*", b):
        if not leftover:
            dm = re.match(r"^(?:samsung|iphone|ipad|redmi|poco)?\s*([a-z]?\d[\w ]*|xr|xs|\d+ ?(?:pro|plus|max|mini|ultra|se)*)$", b)
            leftover = dm.group(1) if dm else ""
        if leftover:
            model_txt = leftover if m.lower() in JUNK else f"{leftover} {m}"
            if brand == "Apple" and not re.match(r"(?i)^(iphone|ipad|ipod|mac|airpods|watch)", model_txt):
                model_txt = "iPhone " + model_txt
            elif brand == "Xiaomi" and re.match(r"(?i)^redmi", b) and not re.match(r"(?i)^(redmi|poco)", model_txt):
                model_txt = "Redmi " + model_txt
            return brand, polish_model(brand, title_case(model_txt, particles=False)), None
    model = None if m.lower() in JUNK else title_case(m, particles=False)
    return brand, polish_model(brand, model), None


def polish_model(brand, model):
    """Post-normalización por familia: iPhone/Galaxy/Moto/Redmi prefijos."""
    if not model or not brand:
        return model
    low = model.lower()
    if brand == "Apple":
        if not re.match(r"(?i)^(iphone|ipad|ipod|macbook|imac|mac |airpods|watch|homepod)", model):
            return "iPhone " + model
    elif brand == "Samsung":
        if re.fullmatch(r"(?i)ng", model):
            return None
        ng = re.match(r"(?i)^ng\s+(.+)$", model)
        if ng:
            return "Galaxy " + ng.group(1)
        if re.match(r"(?i)^(a|s|j|m|z|e|note)\d", low):
            return "Galaxy " + model
    elif brand == "Motorola":
        if re.match(r"(?i)^(g|e|edge|razr)", low) and not low.startswith("moto"):
            return "Moto " + model[0].upper() + model[1:]
    elif brand == "Xiaomi":
        if re.match(r"(?i)^note\s", low):
            return "Redmi " + model
    return model


def equip_type(brand, model, hint):
    text = f"{brand or ''} {model or ''}".lower()
    if hint:
        return hint
    if re.search(r"impresora|printer|deskjet|laserjet|ecotank|pixma|officejet", text):
        return "Impresora"
    if brand in LAPTOP_BRANDS or re.search(r"laptop|notebook|macbook|computadora|\bpc\b", text):
        return "Laptop" if re.search(r"laptop|notebook|macbook", text) else "Computadora"
    if re.search(r"playstation|xbox|nintendo|switch|ps[2-5]|wii|consola|\b360\b", text):
        return "Consola"
    if brand in TV_BRANDS or re.search(r"\btv\b|television|smart tv|pantalla \d", text):
        return "Pantalla"
    if re.search(r"ipad|tablet|\btab\b", text):
        return "Tablet"
    if re.search(r"watch|smartwatch|gear\b", text):
        return "Smartwatch"
    if re.search(r"airpods|audifono|headphone|bocina|speaker", text):
        return "Audífonos" if "airpods" in text or "audifono" in text else "Bocina"
    return "Celular"


def parse_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.year > 2000 else None
    s = norm_ws(v)
    if not s or s.startswith("0000"):
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            d = datetime.strptime(s[:len(fmt) + 2], fmt)
            return d if d.year > 2000 else None
        except ValueError:
            continue
    return None


def cents(v):
    try:
        return max(0, int(round(float(v or 0) * 100)))
    except (TypeError, ValueError):
        return 0


def sq(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def sd(d):
    return "NULL" if d is None else f"'{d.strftime('%Y-%m-%d %H:%M:%S')}'"


def main():
    xlsx, out_sql, report_path = sys.argv[1], sys.argv[2], sys.argv[3]
    rows = list(openpyxl.load_workbook(xlsx, read_only=True)["Sheet1"].iter_rows(values_only=True))[2:]

    sql = ["BEGIN;"]
    sql.append(
        "INSERT INTO \"WorkshopBranch\" (id, name, \"isActive\", \"businessId\") VALUES "
        f"('{BRANCH_MAIN}', 'Sucursal Maneadero', true, '{BUSINESS_ID}'),"
        f"('{BRANCH_CB}', 'Sucursal Cañon Buenavista', true, '{BUSINESS_ID}') "
        "ON CONFLICT (id) DO NOTHING;"
    )
    for uid, name in STAFF.values():
        sql.append(
            "INSERT INTO \"User\" (id, name, role, \"jobTitle\", status, \"businessId\", \"updatedAt\") VALUES "
            f"('{uid}', {sq(name)}, 'EMPLOYEE', 'Recepción', 'APPROVED', '{BUSINESS_ID}', NOW()) "
            "ON CONFLICT (id) DO NOTHING;"
        )

    stats = Counter()
    max_number = 0
    seen_numbers = set()
    for r in rows:
        folio = int(r[0])
        if folio in seen_numbers:
            stats["dup_folio"] += 1
            continue
        seen_numbers.add(folio)
        max_number = max(max_number, folio)

        customer = clean_person(r[1]) or "Cliente sin nombre"
        raw_status = norm_ws(r[2])
        status = STATUS_MAP.get(raw_status.lower())
        if status is None:
            status = "RECEIVED"
            stats["status_unmapped:" + raw_status] += 1
        recv_key = norm_ws(r[3]).lower()
        receiver = STAFF.get(recv_key, (None, None))[0] or FALLBACK_ACTOR
        if recv_key and recv_key not in STAFF:
            stats["receiver_unmapped:" + recv_key] += 1
        tech_key = norm_ws(r[10]).lower()
        assigned = STAFF.get(tech_key, (None, None))[0] if tech_key else None

        brand, model_from_brand, hint = map_brand(r[4], r[5])
        model = model_from_brand
        if model and len(model) > 60:
            model = model[:60]
        etype = equip_type(brand, model, hint)
        serial = norm_ws(r[6]).upper()
        if serial.lower() in JUNK or len(serial) < 4:
            serial = None
        issue = clean_text(r[7]) or "Sin descripción"
        sol = clean_text(r[8])
        part = clean_text(r[9])
        diagnosis = sol or None
        if part:
            diagnosis = (diagnosis + " | " if diagnosis else "") + f"Refacción: {part}"
        received = parse_dt(r[11])
        promised = parse_dt(r[12])
        scheduled = parse_dt(r[13])
        total, paid = cents(r[14]), cents(r[15])
        oid = f"imp-ord-{folio}"
        stats["status:" + status] += 1
        stats["money_total"] += total
        stats["money_paid"] += paid

        quote_approved = total if status in {"DELIVERED", "READY", "IN_REPAIR", "EXTERNAL_LAB"} else None
        diag_fee = total if status in NO_REPAIR else None
        closed_no_repair = "true" if status in NO_REPAIR else "false"
        delivered_to = customer if status == "DELIVERED" else None
        quote_exp = (received + timedelta(days=15)) if status == "WAITING_APPROVAL" and received else None

        sql.append(
            'INSERT INTO "RepairOrder" (id, number, "businessId", status, "customerName", "customerPhone",'
            ' "equipmentType", brand, model, "serialNumber", "reportedIssue", diagnosis, "quoteCents",'
            ' "approvedQuoteCents", "quoteApprovedAt", "diagnosticFeeCents", "closedWithoutRepair",'
            ' "deliveredTo", "deliveredById", "promisedAt", "scheduledAt", "quoteExpiresAt",'
            ' "uploadToken", "quoteToken", "uploadTokenExpiresAt", "intakeBranchId", "currentBranchId",'
            ' "assignedToId", "createdById", "createdAt", "updatedAt") VALUES ('
            f"'{oid}', {folio}, '{BUSINESS_ID}', '{status}', {sq(customer)}, '',"
            f" {sq(etype)}, {sq(brand)}, {sq(model)}, {sq(serial)}, {sq(issue)}, {sq(diagnosis)}, {total},"
            f" {quote_approved if quote_approved is not None else 'NULL'},"
            f" {sd(received) if quote_approved is not None else 'NULL'}, {diag_fee if diag_fee is not None else 'NULL'}, {closed_no_repair},"
            f" {sq(delivered_to)}, {sq(receiver) if status == 'DELIVERED' else 'NULL'}, {sd(promised)}, {sd(scheduled)}, {sd(quote_exp)},"
            f" 'imp-up-{folio}', 'imp-qt-{folio}', NULL, '{BRANCH_MAIN}', '{BRANCH_MAIN}',"
            f" {sq(assigned)}, '{receiver}', {sd(received)}, {sd(received)}) "
            "ON CONFLICT (id) DO NOTHING;"
        )
        recv_detail = f'Orden recibida. Importado de TallerControl folio {folio} — estado original "{raw_status}".'
        sql.append(
            'INSERT INTO "RepairEvent" (id, "businessId", "orderId", "actorId", type, detail, "isPublic", "createdAt") VALUES ('
            f"'imp-ev-{folio}-1', '{BUSINESS_ID}', '{oid}', '{receiver}', 'RECEIVED',"
            f" {sq(recv_detail)}, true, {sd(received)}) "
            "ON CONFLICT (id) DO NOTHING;"
        )
        if status != "RECEIVED":
            sql.append(
                'INSERT INTO "RepairEvent" (id, "businessId", "orderId", "actorId", type, detail, "isPublic", "createdAt") VALUES ('
                f"'imp-ev-{folio}-2', '{BUSINESS_ID}', '{oid}', '{receiver}', 'STATUS',"
                f" {sq('→ ' + STATUS_LABEL[status] + '.')}, true, {sd(received)}) "
                "ON CONFLICT (id) DO NOTHING;"
            )
        if paid > 0:
            purpose = "SETTLEMENT" if paid >= total else "ABONO"
            sql.append(
                'INSERT INTO "Payment" (id, "businessId", "repairOrderId", purpose, method, amount, status, "createdById", notes, "createdAt") VALUES ('
                f"'imp-pay-{folio}', '{BUSINESS_ID}', '{oid}', '{purpose}', 'CASH', {paid / 100:.2f}, 'CONFIRMED',"
                f" '{receiver}', {sq(f'Importado de TallerControl folio {folio} (método desconocido)')}, {sd(received)}) "
                "ON CONFLICT (id) DO NOTHING;"
            )

    sql.append(
        f"SELECT setval('\"RepairOrder_number_seq\"', GREATEST((SELECT MAX(number) FROM \"RepairOrder\"), {max_number}));"
    )
    sql.append("COMMIT;")

    with open(out_sql, "w", encoding="utf-8") as f:
        f.write("\n".join(sql))

    report = {
        "rows": len(rows), "imported": len(seen_numbers),
        "max_number": max_number,
        "stats": dict(stats),
        "money_total_mxn": stats["money_total"] / 100,
        "money_paid_mxn": stats["money_paid"] / 100,
        "money_debt_mxn": (stats["money_total"] - stats["money_paid"]) / 100,
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
