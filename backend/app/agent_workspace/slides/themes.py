"""Design tokens shared by the scene compiler and the frontend viewer."""

W, H = 1280, 720
L, R = 64, 64
CONTENT_W = W - L - R

# Projector-first type scale. Payload floors are enforced in compile.py.
TS = {
    "label": 13,
    "meta": 13,
    "body": 18,
    "small": 16,
    "dense": 17,
    "annotation": 16,
    "evidence": 16,
    "title": 44,
    "cover": 84,
    "quote": 42,
    "footer": 11,
}

THEMES = {
    "paper": {
        "name": "Paper",
        "bg": "#F6F1E7",
        "surface": "#FFFDF8",
        "ink": "#191713",
        "muted": "#6A6255",
        "line": "#DED2C0",
        "accent": "#9B3A2C",
        "accent_soft": "#E9D0C4",
        "dark": "#121614",
        "dark_ink": "#F3EEE1",
        "dark_muted": "#A9A292",
        "dark_line": "#33403A",
        "dark_accent": "#D9785F",
        "title_family": "serif",
        "title_weight": 700,
    },
    "chalk": {
        "name": "Chalk",
        "bg": "#F3F5F7",
        "surface": "#FFFFFF",
        "ink": "#12202B",
        "muted": "#5C6A76",
        "line": "#D3DCE4",
        "accent": "#1E6B74",
        "accent_soft": "#CFE3E5",
        "dark": "#0B1720",
        "dark_ink": "#E9F0F5",
        "dark_muted": "#98A8B5",
        "dark_line": "#26394A",
        "dark_accent": "#79C2C8",
        "title_family": "sans",
        "title_weight": 700,
    },
}
