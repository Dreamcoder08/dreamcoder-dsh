// bench/corpus.ts — corpus de journeys del mini-bench Dreamcoder.
//
// Inspirado en bench/ del ecosistema Gentle-AI (journeys j-numerados, modo
// driven). Reglas heredadas de gentle-ai-bench:
//   - IDs únicos j<N> en TODO el corpus; validateCorpus falla ruidoso.
//   - Cada step declara un comando REAL ejecutable; un journey sin comando
//     ejecutable es un journey muerto.
//   - `axis` pertenece a un vocabulario cerrado; nada de ejes ad-hoc.
//   - Un test verde sobre este corpus SOLO valida declaraciones. La única
//     prueba de ejecución es correr scripts/dream-bench.ts (modo driven).
//
// Los journeys son baratos, deterministas y sin llamadas LLM: prueban que los
// mecanismos del bundle EJECUTAN lo que prometen, no solo que componen.

export type BenchAxis = 'gates' | 'evidence' | 'composition' | 'observability'

export interface BenchStep {
  name: string
  /** Comando ejecutado con `bash -c` desde la raíz del repo. */
  shell: string
  /** Exit esperado: uno o varios aceptados. Default 0. */
  expectExit?: number | number[]
  /** RegExp que el stdout debe satisfacer. */
  expectStdout?: RegExp
  /** RegExp que el stderr debe satisfacer. */
  expectStderr?: RegExp
}

export interface Journey {
  /** Único en todo el corpus, formato j<N>. Jamás reutilizar retirados. */
  id: string
  title: string
  /** POR QUÉ vale la expectativa: decisión ratificada o sección de política. */
  why: string
  axis: BenchAxis
  steps: BenchStep[]
}

export const AXES: readonly BenchAxis[] = ['gates', 'evidence', 'composition', 'observability']

export const journeys: readonly Journey[] = [
  {
    id: 'j1',
    title: 'security-gate bloquea P5 y permite comandos inocuos',
    why: 'policy/AGENTS.md §3: operaciones P5 requieren aprobación humana; el gate es el enforcement mecánico de la deny-list.',
    axis: 'gates',
    steps: [
      {
        name: 'classify marca rm -rf como P5 bloqueado',
        shell: 'node scripts/security-gate.ts classify -- rm -rf /tmp/x',
        expectStdout: /bloqueado: true/,
      },
      {
        name: 'command deniega el P5 con exit 1',
        shell: 'node scripts/security-gate.ts command -- rm -rf /tmp/x',
        expectExit: 1,
      },
      {
        name: 'command permite un comando inocuo con exit 0',
        shell: 'node scripts/security-gate.ts command -- echo bench-ok',
        expectExit: 0,
      },
    ],
  },
  {
    id: 'j2',
    title: 'sdd-gate exige orden estricto de etapas del workflow',
    why: 'Contratos contracts/*.json: el contrato direct exige orden understand→change→verify→publish; saltarse una etapa viola el gate (mini-sdd §8 Verify independently).',
    axis: 'gates',
    steps: [
      {
        name: 'misión direct arranca en understand',
        shell: 'node scripts/sdd-gate.ts start --workflow direct --mission dream-bench-j2',
        expectExit: 0,
      },
      {
        name: 'saltar a verify sin change/verify previos VIOLA el gate',
        shell:
          'node scripts/sdd-gate.ts advance --mission dream-bench-j2 --stage verify --note "salto" ; ' +
          'test $? -eq 1 ; ' +
          'rm -f .evidence/sdd-dream-bench-j2.json',
        expectExit: 0,
        expectStderr: /GATE VIOLADO/,
      },
    ],
  },
  {
    id: 'j3',
    title: 'manifiesto de procedencia detecta drift post-instalación',
    why: 'Fase C (feat 9eb7de3): dream-manifest.sh verify debe salir 0 limpio, 1 con drift y avisar por stderr — sin drift silencioso.',
    axis: 'evidence',
    steps: [
      {
        name: 'generate + verify limpio sobre un DSH_HOME falso',
        shell:
          'H=$(mktemp -d) && mkdir -p "$H/profiles/eng" && ' +
          'echo policy > "$H/AGENTS.md" && echo "{}" > "$H/profiles/eng/package.json" && echo "[]" > "$H/profiles/eng/cordis.patch.yml" && ' +
          'bash scripts/dream-manifest.sh generate "$H" . eng && bash scripts/dream-manifest.sh verify "$H" . eng',
        expectExit: 0,
      },
      {
        name: 'alterar un artefacto tras instalar produce exit 1 con drift nombrado',
        shell:
          'H=$(mktemp -d) && mkdir -p "$H/profiles/eng" && ' +
          'echo policy > "$H/AGENTS.md" && echo "{}" > "$H/profiles/eng/package.json" && echo "[]" > "$H/profiles/eng/cordis.patch.yml" && ' +
          'bash scripts/dream-manifest.sh generate "$H" . eng >/dev/null && ' +
          'echo tampered >> "$H/AGENTS.md" && ' +
          // El veredicto de verify (encabezado + líneas de drift) va por stdout
          // y es lo que consume dream-doctor.sh §13 vía $(…) — se capturan
          // ambas corrientes porque el contrato es la SALIDA COMBINADA.
          'bash scripts/dream-manifest.sh verify "$H" . eng >bench-drift.out 2>&1 ; RC=$? ; ' +
          'grep -q AGENTS.md bench-drift.out ; RC2=$? ; rm -f bench-drift.out ; ' +
          'test "$RC" -eq 1 -a "$RC2" -eq 0',
        expectExit: 0,
      },
    ],
  },
  {
    id: 'j4',
    title: 'context-governor emite veredicto del vocabulario cerrado',
    why: 'policy/AGENTS.md §7: la presión se mide, no se intuye; exit codes exclusivos 0 ok / 1 warning / 2 critical / 3 sin datos.',
    axis: 'observability',
    steps: [
      {
        name: 'governor corre y emite context:ok|warning|critical',
        shell: 'node scripts/context-governor.ts',
        // Cualquiera de los cuatro códigos documentados es un veredicto válido;
        // lo que NO vale es crashear (5) o mal-uso de CLI (4).
        expectExit: [0, 1, 2, 3],
        expectStdout: /context:(ok|warning|critical)/,
      },
    ],
  },
  {
    id: 'j5',
    title: 'dream-doctor declara la instalación saludable',
    why: 'M10 observabilidad: el doctor agrega 13 chequeos con exit agregado; es el gate canónico de salud post-instalación.',
    axis: 'composition',
    steps: [
      {
        name: 'doctor completa con exit 0',
        shell: 'bash scripts/dream-doctor.sh',
        expectExit: 0,
        expectStdout: /instalación saludable/,
      },
    ],
  },
  {
    id: 'j6',
    title: 'el perfil compuesto lleva el guard repeat-tool-reminder afinado',
    why: 'commit 1e4cc56: el override del bundle debe verse en la CONFIGURACIÓN COMPUESTA real (dsh --dump-config), no solo en el YAML fuente — componer no es ejecutar.',
    axis: 'composition',
    steps: [
      {
        name: 'dump-config contiene exclude ask_user_question del override',
        shell:
          "dsh --profile engineering --dump-config 2>/dev/null | grep -A12 'id: repeat-tool-reminder' | grep -q ask_user_question",
        expectExit: 0,
      },
    ],
  },
]
