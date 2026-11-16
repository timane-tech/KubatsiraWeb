"""Gera KubatsiraWeb/dicionario.js a partir do Dicionario.java e do Termos.java da app Android.
Lê as chamadas f("pt", "en") e m("regex", "en") e os textos dos Termos (PT e EN)."""
import json, re, sys

SRC = r"C:\Users\ACER\AndroidStudioProjects\LoanEasyNeon\app\src\main\java\mz\loaneasy\mobile\regras"
OUT = r"C:\Users\ACER\source\repos\KubatsiraWeb\dicionario.js"

CONST = {
    "BuildConfig.EMPRESA": "Kubatsira Microcrédito",
    "BuildConfig.MARCA": "Kubatsira",
    "VERSAO": "1.2",
    "DATA": "07/10/2026",
}

def ler_literal(s, i):
    """s[i] == '"'. Devolve (texto, posição depois da aspa final)."""
    assert s[i] == '"'
    i += 1
    out = []
    while True:
        c = s[i]
        if c == '"':
            return "".join(out), i + 1
        if c == "\\":
            n = s[i + 1]
            if n == "n": out.append("\n"); i += 2
            elif n == "t": out.append("\t"); i += 2
            elif n == "u":
                out.append(chr(int(s[i + 2:i + 6], 16))); i += 6
            else: out.append(n); i += 2
            continue
        out.append(c); i += 1

def ler_expr(s, i):
    """Lê uma expressão de concatenação ("a" + X + "b") até ',' ou ')' ou ';' ao nível 0."""
    partes = []
    while True:
        while s[i] in " \t\r\n+": i += 1
        if s[i] in ",);":
            return "".join(partes), i
        if s[i] == '"':
            t, i = ler_literal(s, i); partes.append(t); continue
        if s[i:i + 2] == "//":
            i = s.index("\n", i); continue
        m = re.match(r"[\w.]+(\(\))?", s[i:])
        if not m: raise ValueError("expr inesperada: " + s[i:i + 60])
        tok = m.group(0); i += len(tok)
        base = tok.replace("mz.loaneasy.mobile.", "")
        up = base.endswith(".toUpperCase()")
        base = base.replace(".toUpperCase()", "")
        if base not in CONST: raise ValueError("constante desconhecida: " + tok)
        v = CONST[base]; v = v.upper() if up else v
        # .replace("A", "B") a seguir
        r = re.match(r'\.replace\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)', s[i:])
        if r: v = v.replace(r.group(1), r.group(2)); i += len(r.group(0))
        partes.append(v)

def chamadas(s, nome):
    res = []
    for m in re.finditer(r"(?<![\w.])" + nome + r"\(\s*\"", s):
        i = m.end() - 1
        a, i = ler_expr(s, i)
        assert s[i] == ","; i += 1
        b, i = ler_expr(s, i)
        res.append([a, b])
    return res

dic = open(SRC + r"\Dicionario.java", encoding="utf-8").read()
# só o corpo (depois das definições de f e m)
corpo = dic[dic.index("private static void m("):]
corpo = corpo[corpo.index("\n"):]
frases = chamadas(corpo, "f")
modelos = chamadas(corpo, "m")

ter = open(SRC + r"\Termos.java", encoding="utf-8").read()
def constante(nome):
    i = ter.index("public static final String " + nome + " =") + len("public static final String " + nome + " =")
    t, _ = ler_expr(ter, i)
    return t
termos_pt, termos_en = constante("TEXTO"), constante("TEXTO_EN")

js = ("/* GERADO a partir de Dicionario.java e Termos.java da app Android (não editar à mão:\n"
      "   correr gerar_dicionario.py). As mesmas traduções da app, para o idioma Inglês. */\n"
      "window.KUB_DIC = " + json.dumps({"frases": frases, "modelos": modelos, "termos": {"pt": termos_pt, "en": termos_en, "versao": "1.2"}},
                                      ensure_ascii=False) + ";\n")
open(OUT, "w", encoding="utf-8", newline="\n").write(js)
print(len(frases), "frases,", len(modelos), "modelos, termos", len(termos_pt), len(termos_en))
