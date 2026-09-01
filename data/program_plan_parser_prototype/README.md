# Program Plan Parser Prototype

This standalone prototype reads the first worksheet of a PKU program-plan
`.xls` or `.xlsx` file and exports a lossless, reviewable JSON description.
It does not import application parser or model code.

```powershell
python data/program_plan_parser_prototype/parse_program_plan.py `
  data/jxjh3.xls `
  data/program_plan_parser_prototype/jxjh3.program-plan.json
```

The exported document contains:

- source metadata and original text;
- series, modules, course groups, and course options;
- typed range constraints;
- aggregate-rule ASTs with resolved internal references;
- mutual-exclusion rules without inventing a selection strategy;
- explicit or external course-membership sources;
- diagnostics and an overall `document_status`.

`needs_review` means the source was preserved but at least one rule or course
membership is not safe to execute automatically. `invalid` is reserved for
fatal structural errors. Unresolved rules must never be treated as passed.
