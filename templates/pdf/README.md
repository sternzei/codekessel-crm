# Fillable PDF Templates (Placeholders)

This directory will hold the real BA/Arbeitsagentur application PDFs plus
their field mappings, provided by the client.

**Do not invent legally-binding form content.** Until the real forms arrive,
the document engine (Phase 5) is built and tested against clearly marked
sample templates only.

Expected layout per form:

```
templates/pdf/
├── <form-key>.pdf          # fillable AcroForm PDF
└── <form-key>.mapping.json # data-model path → PDF field name
```
