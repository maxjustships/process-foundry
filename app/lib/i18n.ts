import {
  DEFAULT_OUTPUT_LOCALE,
  type OutputLocale,
} from "../../domain/output-locale";

export type Locale = OutputLocale;

export const DEFAULT_LOCALE: Locale = DEFAULT_OUTPUT_LOCALE;
export const LOCALES = ["ru", "en"] as const satisfies readonly Locale[];
export const LOCALE_COOKIE_NAME = "bpmn_locale";
const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const en = {
  "app.title": "Process Foundry",
  "app.description": "Private evidence-to-BPMN workspace.",
  "language.label": "Language",
  "language.ru.current": "Russian — selected",
  "language.ru.switch": "Switch to Russian",
  "language.en.current": "English — selected",
  "language.en.switch": "Switch to English",
  "error.oops": "Oops!",
  "error.title": "Error",
  "error.unexpected": "An unexpected error occurred.",
  "error.notFound": "The requested page could not be found.",
  "login.metaTitle": "Sign in · Process Foundry",
  "login.eyebrow": "Private process workshop",
  "login.hero": "Turn evidence into a process you can challenge.",
  "login.summary":
    "Process Foundry keeps raw material private, makes uncertainty visible, and hands the final BPMN model back to a human.",
  "login.boundaryTitle": "Prototype boundary",
  "login.boundary":
    "Use anonymized examples only. Project material stays until you explicitly delete it.",
  "login.step": "01 / Access",
  "login.heading": "Enter the shared phrase",
  "login.hint":
    "The phrase is checked once and is never stored in project data or telemetry.",
  "login.phrase": "Mnemonic phrase",
  "login.checking": "Checking phrase…",
  "login.open": "Open workspace",
  "login.blocked":
    "Sign-in was not accepted. Wait a few minutes and try again.",
  "login.invalid": "Sign-in was not accepted. Check the phrase and try again.",
  "projects.metaTitle": "Projects · Process Foundry",
  "projects.eyebrow": "Process library",
  "projects.heroLine1": "Make the process",
  "projects.heroLine2": "visible and reviewable.",
  "projects.summary":
    "Start from notes, recorded interviews, or a rough sketch. Every output remains editable and every uncertainty remains visible.",
  "projects.new": "New project",
  "projects.title": "Project title",
  "projects.placeholder": "e.g. Vendor invoice approval",
  "projects.creating": "Creating…",
  "projects.create": "Create project",
  "projects.recent": "Recent work",
  "projects.count.one": "{count} project",
  "projects.count.few": "{count} projects",
  "projects.count.many": "{count} projects",
  "projects.updated": "Updated {date}",
  "projects.emptyTitle": "No process models yet",
  "projects.emptyBody":
    "Name the first project above, then add one or more pieces of evidence.",
  "projects.validation.title": "Enter a project title.",
  "nav.telemetry": "Telemetry",
  "nav.projects": "Projects",
  "nav.allProjects": "All projects",
  "project.metaTitle": "Project workspace · Process Foundry",
  "project.label": "Project",
  "project.evidenceStep": "01 / Evidence",
  "project.sourceDesk": "Source desk",
  "project.sourceHint":
    "Combine any confirmed sources. Recordings stay on this device until upload.",
  "project.description": "Process description",
  "project.descriptionPlaceholder":
    "Paste notes, an interview summary, or the process as you understand it…",
  "project.adding": "Adding…",
  "project.confirmText": "Confirm text",
  "project.orFiles": "or add files",
  "project.chooseFiles": "Choose audio, images, or tables",
  "project.fileLimits":
    "Audio ≤ 15 min / 25 MB · images ≤ 10 MB · CSV ≤ 2 MB · DOCX ≤ 8 MB · XLSX ≤ 10 MB",
  "project.tableStructure":
    "Rows, columns, tables, and sheet order are preserved before AI. Table evidence becomes process steps and handoffs; output remains BPMN.",
  "project.uploading": "Uploading…",
  "project.confirmFiles.one": "Confirm {count} file",
  "project.confirmFiles.many": "Confirm {count} files",
  "project.confirmedSources": "Confirmed sources",
  "project.useSource": "Use {name} for generation",
  "project.noSources": "Nothing confirmed yet.",
  "project.generationActive": "Generation in progress",
  "project.starting": "Starting…",
  "project.generateAgain": "Generate another version",
  "project.generate": "Generate BPMN",
  "project.generationLabel": "Durable generation",
  "project.diagramReady": "Diagram ready for review",
  "project.currentStatus": "Currently {status}",
  "project.generationAria": "Generation status: {status}",
  "project.retry": "Retry generation",
  "project.generationFailed":
    "Generation stopped safely. Review the sources and retry.",
  "generation.reviewAction": "Review generation details",
  "generation.refineAction": "Refine current diagram",
  "generation.alternativeAction": "Create alternative diagram",
  "generation.approach": "Generation approach",
  "generation.preflightAria": "Generation preflight",
  "generation.preflight": "Generation preflight",
  "generation.version": "Version {number}",
  "generation.mode.refine": "Refine current diagram",
  "generation.mode.alternative": "Alternative diagram",
  "generation.mode.human": "human edit",
  "generation.mode.legacy": "legacy version",
  "generation.baseVersion": "Base version {number}",
  "generation.noBase": "No base version",
  "generation.source.one": "{count} source",
  "generation.source.many": "{count} sources",
  "generation.clarification.one": "{count} clarification",
  "generation.clarification.many": "{count} clarifications",
  "generation.autoAnswers": "Auto-applied answers",
  "generation.noAutoAnswers": "No confirmed answers will be applied",
  "generation.preserveVersions": "Earlier versions will be preserved",
  "generation.bpmnOnly":
    "Output remains BPMN 2.0; architecture and data-flow diagrams are not generated.",
  "generation.bpmnBoundary":
    "BPMN only: describe process steps and handoffs. Requests for architecture or data-flow views become review questions.",
  "generation.confirm": "Generate version {number}",
  "generation.editSelection": "Edit source selection",
  "generation.progressAria": "Generation progress",
  "generation.cancel": "Cancel generation",
  "generation.cancelling": "Cancelling…",
  "generation.cancelled": "Generation cancelled",
  "generation.retrySnapshot": "Retry identical snapshot",
  "generation.failureDetail":
    "Failed at {stage} · code {code}. No source or provider content is shown.",
  "generation.provenanceUnavailable": "provenance unavailable",
  "project.version": "Version",
  "project.canvasWaiting": "Canvas waiting",
  "project.evidenceFirst": "Evidence first.",
  "project.diagramSecond": "Diagram second.",
  "project.emptyCanvas":
    "Confirm at least one source, then start generation. Refreshing this page will not lose a running job.",
  "project.reviewStep": "03 / Review",
  "project.evidenceNotes": "Evidence notes",
  "project.reviewHint":
    "Questions stay outside the model until a reviewer resolves them.",
  "project.questions": "Questions",
  "question.answerLabel": "Confirmed answer",
  "question.answerPlaceholder": "Enter the confirmed answer",
  "question.confirm": "Confirm answer",
  "question.confirming": "Confirming…",
  "question.status.open": "Open",
  "question.status.answered": "Answered — not yet applied",
  "question.status.applied": "Applied in version {number}",
  "question.pending.one": "{count} answered clarification awaits rebuild",
  "question.pending.many": "{count} answered clarifications await rebuild",
  "question.rebuild.one": "Rebuild BPMN with {count} clarification",
  "question.rebuild.many": "Rebuild BPMN with {count} clarifications",
  "question.history": "Applied clarification history",
  "question.historyOrigin": "Origin version {number}",
  "project.related.one": "{count} related element",
  "project.related.many": "{count} related elements",
  "project.noQuestions": "No open questions in this version.",
  "project.assumptions": "Assumptions",
  "project.modelElement": "Model element · {type}",
  "project.sourceReferences": "Source references",
  "project.sourceFallback": "Source",
  "project.correctionTitle": "Correct the source record",
  "project.correctionLabel": "Project-level correction",
  "project.correctionPlaceholder":
    "e.g. Finance, not the director, performs approval.",
  "project.regenerate": "Add correction and regenerate",
  "project.rate": "Rate this result",
  "project.ratingAria": "Result rating",
  "project.ratingValue": "{value} out of 5",
  "project.feedback": "Feedback",
  "project.feedbackPlaceholder": "What was useful or needs correction?",
  "project.feedbackSaving": "Saving feedback…",
  "project.feedbackSave": "Save feedback",
  "project.feedbackSaved": "Feedback saved · ID {id}",
  "project.deleteSummary": "Delete project data",
  "project.deleteExplanation":
    "Deletes all project sources, transcripts, diagrams, jobs, and linked telemetry from D1 and R2. Explicit feedback remains separate.",
  "project.deleteConfirm": "I understand this cannot be undone.",
  "project.deleting": "Deleting and verifying…",
  "project.deleteButton": "Delete project and source data",
  "source.name.text": "Pasted process description",
  "source.name.correction": "Reviewer correction",
  "source.name.questionClarification": "Confirmed question answer",
  "source.name.recording": "Browser recording.webm",
  "source.type.text": "text",
  "source.type.correction": "correction",
  "source.type.audio": "audio",
  "source.type.image": "image",
  "source.type.csv": "CSV table",
  "source.type.docx": "Word table",
  "source.type.xlsx": "Excel workbook",
  "source.generic.audio": "audio source",
  "source.generic.image": "image source",
  "source.generic.file": "file source",
  "status.active": "active",
  "status.deleting": "deleting",
  "status.queued": "queued",
  "status.transcribing": "transcribing",
  "status.extracting": "extracting",
  "status.validating": "validating",
  "status.compiling": "compiling",
  "status.cancelling": "cancelling",
  "status.cancelled": "cancelled",
  "status.ready": "ready",
  "status.failed": "failed",
  "severity.minor": "minor",
  "severity.important": "important",
  "severity.blocking": "blocking",
  "creator.human": "human",
  "creator.ai": "AI",
  "recorder.title": "Record an interview",
  "recorder.status.checking": "checking",
  "recorder.status.idle": "idle",
  "recorder.status.requesting": "requesting",
  "recorder.status.ready": "ready",
  "recorder.status.recording": "recording",
  "recorder.status.paused": "paused",
  "recorder.status.stopped": "stopped",
  "recorder.status.denied": "denied",
  "recorder.status.no-device": "no device",
  "recorder.status.unsupported": "unsupported",
  "recorder.request": "Request microphone",
  "recorder.start": "Start recording",
  "recorder.resume": "Resume",
  "recorder.pause": "Pause",
  "recorder.stop": "Stop",
  "recorder.confirm": "Confirm and upload",
  "recorder.discard": "Discard recording",
  "recorder.noDevice":
    "No microphone was found. Connect one or upload an audio file.",
  "recorder.denied":
    "Microphone access was denied. Allow access in browser settings or upload an audio file.",
  "recorder.tooLarge":
    "Recording is larger than 25 MB. Discard it and record a shorter clip.",
  "recorder.uploadError": "Recording could not be uploaded.",
  "recorder.unsupported":
    "This browser cannot record audio. Upload an existing audio file instead.",
  "editor.aria": "Editable BPMN diagram",
  "editor.loading": "Loading editor…",
  "editor.loaded": "Editable BPMN loaded",
  "editor.loadError": "The BPMN diagram could not be loaded.",
  "editor.saving": "Saving a new immutable version…",
  "editor.saveError": "The edited version could not be saved.",
  "editor.saved": "Version {number} saved",
  "editor.unsaved": "Unsaved edits",
  "editor.workspace": "Diagram workspace",
  "editor.controls": "Diagram controls",
  "editor.undo": "Undo",
  "editor.redo": "Redo",
  "editor.fit": "Fit diagram",
  "editor.zoomOut": "Zoom out",
  "editor.zoomIn": "Zoom in",
  "editor.expand": "Expand diagram",
  "editor.collapse": "Collapse diagram",
  "editor.historyBaselineImported":
    "Version loaded. Undo and redo history were reset; this import is the new baseline.",
  "editor.historyBaselineSaved":
    "Version {number} saved. Undo and redo history were reset; the saved version is the new baseline.",
  "editor.save": "Save new version",
  "editor.export": "Export .bpmn",
  "editor.exports": "Live diagram exports",
  "editor.export.bpmn": "Export BPMN",
  "editor.export.svg": "Export SVG",
  "editor.export.png": "Export high-resolution PNG",
  "editor.exported.bpmn": "Current BPMN downloaded",
  "editor.exported.svg": "Current SVG downloaded",
  "editor.exported.png": "High-resolution PNG downloaded",
  "editor.exportError":
    "The current diagram could not be exported. Try again without leaving the editor.",
  "telemetry.metaTitle": "Telemetry timeline · Process Foundry",
  "telemetry.eyebrow": "Private operations view",
  "telemetry.heading": "Semantic timeline",
  "telemetry.summary":
    "Ordered product actions and safe model metadata. No source text, transcripts, labels, coordinates, or feedback content appears here.",
  "telemetry.session": "Session",
  "telemetry.project": "Project",
  "telemetry.job": "Job",
  "telemetry.version": "Version",
  "telemetry.eventType": "Event type",
  "telemetry.from": "From",
  "telemetry.to": "To",
  "telemetry.apply": "Apply filters",
  "telemetry.events": "Events",
  "telemetry.shown": "{count} shown",
  "telemetry.emptyTitle": "No matching semantic events",
  "telemetry.emptyBody":
    "Use the product or broaden the filters. Telemetry failure never blocks core work.",
  "error.projectNotFound": "Project was not found.",
  "error.questionNotFound": "Question was not found in this project version.",
  "error.questionAnswer": "Enter an answer of up to 5,000 characters.",
  "error.questionConflict":
    "This question already has a different confirmed answer.",
  "error.questionUnavailable":
    "Confirmed answer evidence is temporarily unavailable.",
  "error.audioDuration": "Audio duration could not be read.",
  "error.textUpload": "Text source could not be added.",
  "error.fileUpload": "{name} could not be uploaded.",
  "error.filesUpload": "Files could not be uploaded.",
  "error.generationStart": "Generation could not be started.",
  "error.generationIntent":
    "Choose the generation mode and at least one explicit source.",
  "error.generationBaseStale":
    "A newer version is available. Review it before refining the diagram.",
  "error.cancelFailed":
    "Generation could not be stopped safely. Retry cancellation before continuing.",
  "error.retryUnavailable":
    "Only a failed or cancelled generation can be retried.",
  "error.feedbackSave": "Feedback could not be saved.",
  "error.deleteVerify": "Deletion could not be verified. Retry from this page.",
  "error.mutationOrigin": "Mutation origin was not accepted.",
  "error.requestLarge": "Request is too large.",
  "error.invalidJson": "Request body must be valid JSON.",
  "error.telemetryBatch": "Telemetry batch was not accepted.",
  "error.noExport": "No BPMN version is ready for export.",
  "error.feedbackInput":
    "Choose a rating and enter feedback of up to 5,000 characters.",
  "error.addSource": "Add at least one confirmed source before generation.",
  "error.jobNotFound": "Generation job was not found.",
  "error.sourceType": "Source type is not supported.",
  "error.table.unsupported":
    "Only CSV, DOCX, and XLSX table files are supported. XLS, XLSM, DOCM, ODS, PDF, and ZIP are not accepted.",
  "error.table.mimeMismatch":
    "The file type does not match its extension. Export it as CSV, DOCX, or XLSX and try again.",
  "error.table.malformed":
    "The table file is malformed or contains no supported visible table data.",
  "error.table.unsafeArchive":
    "The file is an unsafe or malformed Office archive. Remove macros, encryption, embedded objects, and external links, then export a fresh DOCX or XLSX.",
  "error.table.limit.fileBytes":
    "The table file exceeds its format byte limit.",
  "error.table.limit.archiveEntries":
    "The Office file contains too many archive entries.",
  "error.table.limit.archiveBytes":
    "The Office file expands beyond the safe total archive limit.",
  "error.table.limit.entryBytes":
    "An Office file part exceeds the safe entry byte limit.",
  "error.table.limit.compressionRatio":
    "The Office file has an unsafe compression ratio.",
  "error.table.limit.sheets": "The workbook contains more than 16 sheets.",
  "error.table.limit.tables": "The document contains more than 32 tables.",
  "error.table.limit.rows": "A table or sheet contains more than 1,000 rows.",
  "error.table.limit.columns":
    "A table or sheet contains more than 64 columns.",
  "error.table.limit.totalCells": "The file contains more than 20,000 cells.",
  "error.table.limit.cellCharacters":
    "A cell contains more than 2,000 characters.",
  "error.table.limit.extractedCharacters":
    "The structured extraction exceeds 200,000 characters.",
  "error.table.limit.xmlDepth":
    "The Office XML nesting exceeds the safe depth limit.",
  "error.table.limit.generic": "The table file exceeds a safe ingestion limit.",
  "error.textInput": "Enter a text source of up to 50,000 characters.",
  "error.sourceMaximum":
    "This project already has the maximum number of {kind} sources.",
  "error.emptyFile": "Choose a non-empty file.",
  "error.audioType": "Use WebM, OGG, MP3, MP4, or WAV audio.",
  "error.audioSize": "Audio must be 25 MB or smaller.",
  "error.audioLength": "Audio must be 15 minutes or shorter.",
  "error.imageType": "Use JPEG, PNG, WebP, HEIC, or HEIF images.",
  "error.imageSize": "Images must be 10 MB or smaller after resizing.",
  "error.bpmnSize": "BPMN XML must be 2 MB or smaller.",
  "error.bpmnWarnings":
    "The edited BPMN contains structural warnings and was not saved.",
  "error.bpmnParse": "The edited BPMN could not be parsed and was not saved.",
} as const;

type MessageKey = keyof typeof en;
type Dictionary = { readonly [Key in MessageKey]: string };

const ru = {
  "app.title": "Process Foundry",
  "app.description":
    "Закрытое пространство для создания BPMN по исходным материалам.",
  "language.label": "Язык",
  "language.ru.current": "Русский — выбран",
  "language.ru.switch": "Переключить на русский",
  "language.en.current": "English — выбран",
  "language.en.switch": "Switch to English",
  "error.oops": "Что-то пошло не так",
  "error.title": "Ошибка",
  "error.unexpected": "Произошла непредвиденная ошибка.",
  "error.notFound": "Запрошенная страница не найдена.",
  "login.metaTitle": "Вход · Process Foundry",
  "login.eyebrow": "Закрытая мастерская процессов",
  "login.hero":
    "Превратите исходные материалы в процесс, который можно проверить.",
  "login.summary":
    "Process Foundry сохраняет исходные материалы в закрытом контуре, показывает неопределённость и оставляет окончательное решение о BPMN-модели за человеком.",
  "login.boundaryTitle": "Ограничения прототипа",
  "login.boundary":
    "Используйте только обезличенные примеры. Материалы проекта хранятся, пока вы не удалите их вручную.",
  "login.step": "01 / Доступ",
  "login.heading": "Введите общую фразу",
  "login.hint":
    "Фраза проверяется один раз и не сохраняется ни в данных проекта, ни в телеметрии.",
  "login.phrase": "Мнемоническая фраза",
  "login.checking": "Проверяем фразу…",
  "login.open": "Открыть рабочее пространство",
  "login.blocked":
    "Войти не удалось. Подождите несколько минут и повторите попытку.",
  "login.invalid": "Войти не удалось. Проверьте фразу и попробуйте ещё раз.",
  "projects.metaTitle": "Проекты · Process Foundry",
  "projects.eyebrow": "Библиотека процессов",
  "projects.heroLine1": "Сделайте процесс",
  "projects.heroLine2": "наглядным и проверяемым.",
  "projects.summary":
    "Начните с заметок, записи интервью или чернового эскиза. Результат можно редактировать, а все неясности остаются на виду.",
  "projects.new": "Новый проект",
  "projects.title": "Название проекта",
  "projects.placeholder": "Например, согласование счёта поставщика",
  "projects.creating": "Создаём…",
  "projects.create": "Создать проект",
  "projects.recent": "Недавние проекты",
  "projects.count.one": "{count} проект",
  "projects.count.few": "{count} проекта",
  "projects.count.many": "{count} проектов",
  "projects.updated": "Обновлён {date}",
  "projects.emptyTitle": "Моделей процессов пока нет",
  "projects.emptyBody":
    "Введите название первого проекта выше, а затем добавьте один или несколько исходных материалов.",
  "projects.validation.title": "Введите название проекта.",
  "nav.telemetry": "Телеметрия",
  "nav.projects": "Проекты",
  "nav.allProjects": "Все проекты",
  "project.metaTitle": "Рабочее пространство проекта · Process Foundry",
  "project.label": "Проект",
  "project.evidenceStep": "01 / Материалы",
  "project.sourceDesk": "Исходные материалы",
  "project.sourceHint":
    "Объединяйте любые подтверждённые материалы. До загрузки записи остаются только на этом устройстве.",
  "project.description": "Описание процесса",
  "project.descriptionPlaceholder":
    "Вставьте заметки, краткое содержание интервью или своё описание процесса…",
  "project.adding": "Добавляем…",
  "project.confirmText": "Подтвердить текст",
  "project.orFiles": "или добавьте файлы",
  "project.chooseFiles": "Выбрать аудио, изображения или таблицы",
  "project.fileLimits":
    "Аудио ≤ 15 мин / 25 МБ · изображения ≤ 10 МБ · CSV ≤ 2 МБ · DOCX ≤ 8 МБ · XLSX ≤ 10 МБ",
  "project.tableStructure":
    "Строки, столбцы, таблицы и порядок листов сохраняются до обработки ИИ. Табличные материалы трактуются как этапы и передачи процесса; результат остаётся BPMN.",
  "project.uploading": "Загружаем…",
  "project.confirmFiles.one": "Подтвердить {count} файл",
  "project.confirmFiles.many": "Подтвердить файлы: {count}",
  "project.confirmedSources": "Подтверждённые материалы",
  "project.useSource": "Использовать «{name}» для генерации",
  "project.noSources": "Пока ничего не подтверждено.",
  "project.generationActive": "Идёт создание диаграммы",
  "project.starting": "Запускаем…",
  "project.generateAgain": "Создать ещё одну версию",
  "project.generate": "Создать BPMN",
  "project.generationLabel": "Надёжная генерация",
  "project.diagramReady": "Диаграмма готова к проверке",
  "project.currentStatus": "Текущий этап: {status}",
  "project.generationAria": "Состояние генерации: {status}",
  "project.retry": "Повторить генерацию",
  "project.generationFailed":
    "Генерация безопасно остановлена. Проверьте исходные материалы и повторите попытку.",
  "generation.reviewAction": "Проверить параметры генерации",
  "generation.refineAction": "Уточнить текущую схему",
  "generation.alternativeAction": "Создать альтернативную схему",
  "generation.approach": "Способ создания версии",
  "generation.preflightAria": "Проверка перед генерацией",
  "generation.preflight": "Проверка перед генерацией",
  "generation.version": "Версия {number}",
  "generation.mode.refine": "Уточнение текущей схемы",
  "generation.mode.alternative": "Альтернативная схема",
  "generation.mode.human": "ручное изменение",
  "generation.mode.legacy": "старая версия",
  "generation.baseVersion": "Базовая версия {number}",
  "generation.noBase": "Без базовой версии",
  "generation.source.one": "{count} материал",
  "generation.source.many": "Материалов: {count}",
  "generation.clarification.one": "{count} уточнение",
  "generation.clarification.many": "Уточнений: {count}",
  "generation.autoAnswers": "Автоматически применяемые ответы",
  "generation.noAutoAnswers": "Подтверждённые ответы не будут применены",
  "generation.preserveVersions": "Предыдущие версии сохранятся",
  "generation.bpmnOnly":
    "Результат остаётся BPMN 2.0; архитектурные схемы и диаграммы потоков данных не создаются.",
  "generation.bpmnBoundary":
    "Только BPMN: опишите этапы процесса и передачу работы. Запросы архитектурных схем или потоков данных станут вопросами для проверки.",
  "generation.confirm": "Создать версию {number}",
  "generation.editSelection": "Изменить выбор материалов",
  "generation.progressAria": "Ход генерации",
  "generation.cancel": "Отменить генерацию",
  "generation.cancelling": "Отменяем…",
  "generation.cancelled": "Генерация отменена",
  "generation.retrySnapshot": "Повторить тот же набор",
  "generation.failureDetail":
    "Сбой на этапе «{stage}» · код {code}. Содержимое материалов и ответ провайдера не показываются.",
  "generation.provenanceUnavailable": "данные о происхождении недоступны",
  "project.version": "Версия",
  "project.canvasWaiting": "Холст ожидает",
  "project.evidenceFirst": "Сначала материалы.",
  "project.diagramSecond": "Затем диаграмма.",
  "project.emptyCanvas":
    "Подтвердите хотя бы один материал и запустите генерацию. Обновление страницы не прервёт выполняющуюся задачу.",
  "project.reviewStep": "03 / Проверка",
  "project.evidenceNotes": "Заметки по материалам",
  "project.reviewHint":
    "Вопросы остаются за пределами модели, пока проверяющий не даст ответ.",
  "project.questions": "Вопросы",
  "question.answerLabel": "Подтверждённый ответ",
  "question.answerPlaceholder": "Введите подтверждённый ответ",
  "question.confirm": "Подтвердить ответ",
  "question.confirming": "Подтверждаем…",
  "question.status.open": "Открыт",
  "question.status.answered": "Есть ответ — ещё не применён",
  "question.status.applied": "Применён в версии {number}",
  "question.pending.one": "{count} уточнение с ответом ожидает пересборки",
  "question.pending.many": "{count} уточнения с ответами ожидают пересборки",
  "question.rebuild.one": "Пересобрать BPMN с {count} уточнением",
  "question.rebuild.many": "Пересобрать BPMN с {count} уточнениями",
  "question.history": "История применённых уточнений",
  "question.historyOrigin": "Исходная версия {number}",
  "project.related.one": "Связанный элемент: {count}",
  "project.related.many": "Связанных элементов: {count}",
  "project.noQuestions": "В этой версии нет открытых вопросов.",
  "project.assumptions": "Допущения",
  "project.modelElement": "Элемент модели · {type}",
  "project.sourceReferences": "Ссылки на материалы",
  "project.sourceFallback": "Материал",
  "project.correctionTitle": "Уточнить исходные сведения",
  "project.correctionLabel": "Уточнение для всего проекта",
  "project.correctionPlaceholder":
    "Например, согласование выполняет финансовый отдел, а не директор.",
  "project.regenerate": "Добавить уточнение и создать заново",
  "project.rate": "Оцените результат",
  "project.ratingAria": "Оценка результата",
  "project.ratingValue": "{value} из 5",
  "project.feedback": "Отзыв",
  "project.feedbackPlaceholder": "Что было полезно или что нужно исправить?",
  "project.feedbackSaving": "Сохраняем отзыв…",
  "project.feedbackSave": "Сохранить отзыв",
  "project.feedbackSaved": "Отзыв сохранён · ID {id}",
  "project.deleteSummary": "Удалить данные проекта",
  "project.deleteExplanation":
    "Удаляет из D1 и R2 все материалы, расшифровки, диаграммы, задания и связанную телеметрию проекта. Отправленные отзывы хранятся отдельно.",
  "project.deleteConfirm": "Я понимаю, что это действие нельзя отменить.",
  "project.deleting": "Удаляем и проверяем…",
  "project.deleteButton": "Удалить проект и исходные материалы",
  "source.name.text": "Описание процесса из буфера",
  "source.name.correction": "Уточнение проверяющего",
  "source.name.questionClarification": "Подтверждённый ответ на вопрос",
  "source.name.recording": "Запись из браузера.webm",
  "source.type.text": "текст",
  "source.type.correction": "уточнение",
  "source.type.audio": "аудио",
  "source.type.image": "изображение",
  "source.type.csv": "таблица CSV",
  "source.type.docx": "таблица Word",
  "source.type.xlsx": "книга Excel",
  "source.generic.audio": "аудиоматериал",
  "source.generic.image": "изображение",
  "source.generic.file": "файл",
  "status.active": "активен",
  "status.deleting": "удаляется",
  "status.queued": "в очереди",
  "status.transcribing": "расшифровка",
  "status.extracting": "выделение процесса",
  "status.validating": "проверка",
  "status.compiling": "сборка",
  "status.cancelling": "отмена",
  "status.cancelled": "отменено",
  "status.ready": "готово",
  "status.failed": "ошибка",
  "severity.minor": "небольшая",
  "severity.important": "важная",
  "severity.blocking": "блокирующая",
  "creator.human": "человек",
  "creator.ai": "ИИ",
  "recorder.title": "Записать интервью",
  "recorder.status.checking": "проверка",
  "recorder.status.idle": "готов к работе",
  "recorder.status.requesting": "запрос доступа",
  "recorder.status.ready": "готов",
  "recorder.status.recording": "идёт запись",
  "recorder.status.paused": "пауза",
  "recorder.status.stopped": "запись завершена",
  "recorder.status.denied": "доступ запрещён",
  "recorder.status.no-device": "микрофон не найден",
  "recorder.status.unsupported": "не поддерживается",
  "recorder.request": "Запросить доступ к микрофону",
  "recorder.start": "Начать запись",
  "recorder.resume": "Продолжить",
  "recorder.pause": "Пауза",
  "recorder.stop": "Остановить",
  "recorder.confirm": "Подтвердить и загрузить",
  "recorder.discard": "Удалить запись",
  "recorder.noDevice":
    "Микрофон не найден. Подключите его или загрузите аудиофайл.",
  "recorder.denied":
    "Доступ к микрофону запрещён. Разрешите его в настройках браузера или загрузите аудиофайл.",
  "recorder.tooLarge":
    "Запись больше 25 МБ. Удалите её и запишите более короткий фрагмент.",
  "recorder.uploadError": "Не удалось загрузить запись.",
  "recorder.unsupported":
    "Этот браузер не умеет записывать аудио. Загрузите готовый аудиофайл.",
  "editor.aria": "Редактируемая диаграмма BPMN",
  "editor.loading": "Загружаем редактор…",
  "editor.loaded": "Редактируемая диаграмма BPMN загружена",
  "editor.loadError": "Не удалось загрузить диаграмму BPMN.",
  "editor.saving": "Сохраняем новую неизменяемую версию…",
  "editor.saveError": "Не удалось сохранить отредактированную версию.",
  "editor.saved": "Версия {number} сохранена",
  "editor.unsaved": "Есть несохранённые изменения",
  "editor.workspace": "Рабочая область диаграммы",
  "editor.controls": "Управление диаграммой",
  "editor.undo": "Отменить",
  "editor.redo": "Повторить",
  "editor.fit": "Вписать диаграмму",
  "editor.zoomOut": "Уменьшить масштаб",
  "editor.zoomIn": "Увеличить масштаб",
  "editor.expand": "Развернуть диаграмму",
  "editor.collapse": "Свернуть диаграмму",
  "editor.historyBaselineImported":
    "Версия загружена. История отмены и повтора сброшена; этот импорт — новая точка отсчёта.",
  "editor.historyBaselineSaved":
    "Версия {number} сохранена. История отмены и повтора сброшена; сохранённая версия — новая точка отсчёта.",
  "editor.save": "Сохранить новую версию",
  "editor.export": "Экспорт .bpmn",
  "editor.exports": "Экспорт текущей диаграммы",
  "editor.export.bpmn": "Экспорт BPMN",
  "editor.export.svg": "Экспорт SVG",
  "editor.export.png": "Экспорт PNG высокого разрешения",
  "editor.exported.bpmn": "Текущая BPMN скачана",
  "editor.exported.svg": "Текущий SVG скачан",
  "editor.exported.png": "PNG высокого разрешения скачан",
  "editor.exportError":
    "Не удалось экспортировать текущую диаграмму. Повторите попытку, не закрывая редактор.",
  "telemetry.metaTitle": "Хронология телеметрии · Process Foundry",
  "telemetry.eyebrow": "Закрытая служебная страница",
  "telemetry.heading": "Семантическая хронология",
  "telemetry.summary":
    "Упорядоченные действия в продукте и безопасные метаданные модели. Здесь нет исходного текста, расшифровок, названий элементов, координат и текста отзывов.",
  "telemetry.session": "Сеанс",
  "telemetry.project": "Проект",
  "telemetry.job": "Задание",
  "telemetry.version": "Версия",
  "telemetry.eventType": "Тип события",
  "telemetry.from": "С",
  "telemetry.to": "По",
  "telemetry.apply": "Применить фильтры",
  "telemetry.events": "События",
  "telemetry.shown": "Показано: {count}",
  "telemetry.emptyTitle": "Подходящих семантических событий нет",
  "telemetry.emptyBody":
    "Поработайте в продукте или расширьте фильтры. Сбой телеметрии никогда не мешает основной работе.",
  "error.projectNotFound": "Проект не найден.",
  "error.questionNotFound": "Вопрос не найден в этой версии проекта.",
  "error.questionAnswer": "Введите ответ длиной до 5 000 символов.",
  "error.questionConflict": "Для этого вопроса уже подтверждён другой ответ.",
  "error.questionUnavailable":
    "Материал с подтверждённым ответом временно недоступен.",
  "error.audioDuration": "Не удалось определить длительность аудио.",
  "error.textUpload": "Не удалось добавить текстовый материал.",
  "error.fileUpload": "Не удалось загрузить файл «{name}».",
  "error.filesUpload": "Не удалось загрузить файлы.",
  "error.generationStart": "Не удалось запустить генерацию.",
  "error.generationIntent":
    "Выберите режим генерации и хотя бы один материал явно.",
  "error.generationBaseStale":
    "Уже доступна более новая версия. Проверьте её перед уточнением схемы.",
  "error.cancelFailed":
    "Не удалось безопасно остановить генерацию. Повторите отмену перед продолжением.",
  "error.retryUnavailable":
    "Повторить можно только неудачную или отменённую генерацию.",
  "error.feedbackSave": "Не удалось сохранить отзыв.",
  "error.deleteVerify":
    "Не удалось подтвердить удаление. Повторите попытку на этой странице.",
  "error.mutationOrigin": "Источник запроса на изменение не прошёл проверку.",
  "error.requestLarge": "Запрос слишком большой.",
  "error.invalidJson": "Тело запроса должно содержать корректный JSON.",
  "error.telemetryBatch": "Пакет телеметрии не принят.",
  "error.noExport": "Нет готовой версии BPMN для экспорта.",
  "error.feedbackInput":
    "Выберите оценку и введите отзыв длиной до 5 000 символов.",
  "error.addSource":
    "Перед генерацией добавьте хотя бы один подтверждённый материал.",
  "error.jobNotFound": "Задание генерации не найдено.",
  "error.sourceType": "Этот тип материала не поддерживается.",
  "error.table.unsupported":
    "Поддерживаются только таблицы CSV, DOCX и XLSX. XLS, XLSM, DOCM, ODS, PDF и ZIP не принимаются.",
  "error.table.mimeMismatch":
    "Тип файла не соответствует расширению. Экспортируйте его как CSV, DOCX или XLSX и повторите попытку.",
  "error.table.malformed":
    "Табличный файл повреждён или не содержит поддерживаемых видимых табличных данных.",
  "error.table.unsafeArchive":
    "Это небезопасный или повреждённый архив Office. Удалите макросы, шифрование, встроенные объекты и внешние ссылки, затем экспортируйте новый DOCX или XLSX.",
  "error.table.limit.fileBytes":
    "Табличный файл превышает лимит байтов для своего формата.",
  "error.table.limit.archiveEntries":
    "В файле Office слишком много архивных записей.",
  "error.table.limit.archiveBytes":
    "Файл Office распаковывается сверх безопасного общего лимита.",
  "error.table.limit.entryBytes":
    "Часть файла Office превышает безопасный лимит байтов.",
  "error.table.limit.compressionRatio":
    "У файла Office небезопасная степень сжатия.",
  "error.table.limit.sheets": "В книге больше 16 листов.",
  "error.table.limit.tables": "В документе больше 32 таблиц.",
  "error.table.limit.rows": "В таблице или листе больше 1 000 строк.",
  "error.table.limit.columns": "В таблице или листе больше 64 столбцов.",
  "error.table.limit.totalCells": "В файле больше 20 000 ячеек.",
  "error.table.limit.cellCharacters": "В ячейке больше 2 000 символов.",
  "error.table.limit.extractedCharacters":
    "Структурированное извлечение превышает 200 000 символов.",
  "error.table.limit.xmlDepth":
    "Вложенность XML Office превышает безопасный лимит.",
  "error.table.limit.generic":
    "Табличный файл превышает безопасный лимит загрузки.",
  "error.textInput": "Введите текстовый материал длиной до 50 000 символов.",
  "error.sourceMaximum":
    "В проект уже добавлено максимально допустимое число материалов типа «{kind}».",
  "error.emptyFile": "Выберите непустой файл.",
  "error.audioType": "Используйте аудио WebM, OGG, MP3, MP4 или WAV.",
  "error.audioSize": "Размер аудио не должен превышать 25 МБ.",
  "error.audioLength": "Длительность аудио не должна превышать 15 минут.",
  "error.imageType": "Используйте изображения JPEG, PNG, WebP, HEIC или HEIF.",
  "error.imageSize":
    "После уменьшения размер изображения не должен превышать 10 МБ.",
  "error.bpmnSize": "Размер BPMN XML не должен превышать 2 МБ.",
  "error.bpmnWarnings":
    "В изменённой BPMN есть структурные предупреждения, поэтому версия не сохранена.",
  "error.bpmnParse":
    "Не удалось разобрать изменённую BPMN, поэтому версия не сохранена.",
} as const satisfies Dictionary;

export const dictionaries: Readonly<Record<Locale, Dictionary>> = { en, ru };

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}

export function resolveLocale(request: Request): Locale {
  const value =
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LOCALE_COOKIE_NAME}=`))
      ?.slice(LOCALE_COOKIE_NAME.length + 1) ?? null;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeCookie(locale: Locale, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${LOCALE_COOKIE_NAME}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

export function safeReturnTarget(value: FormDataEntryValue | null): string {
  const hasControlCharacter =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    hasControlCharacter
  )
    return "/";
  const parsed = new URL(value, "https://local.invalid");
  if (parsed.origin !== "https://local.invalid") return "/";
  return `${parsed.pathname}${parsed.search}`;
}

export function t(
  locale: Locale,
  key: MessageKey,
  replacements: Readonly<Record<string, string | number>> = {},
): string {
  return dictionaries[locale][key].replace(
    /\{([^}]+)\}/gu,
    (match, name: string) =>
      Object.hasOwn(replacements, name) ? String(replacements[name]) : match,
  );
}

export function messageKeyForStatus(status: string): MessageKey | null {
  const key = `status.${status}` as MessageKey;
  return Object.hasOwn(en, key) ? key : null;
}

export function displayStatus(locale: Locale, status: string): string {
  const key = messageKeyForStatus(status);
  return key ? t(locale, key) : status;
}

const builtInSourceNames = {
  text: {
    key: "source.name.text",
    values: new Set<string>([en["source.name.text"], ru["source.name.text"]]),
  },
  correction: {
    key: "source.name.correction",
    values: new Set<string>([
      en["source.name.correction"],
      ru["source.name.correction"],
    ]),
  },
  audio: {
    key: "source.name.recording",
    values: new Set<string>([
      en["source.name.recording"],
      ru["source.name.recording"],
    ]),
  },
} as const;

export function displaySourceName(
  locale: Locale,
  type: string,
  name: string,
): string {
  if (
    type === "correction" &&
    (name === en["source.name.questionClarification"] ||
      name === ru["source.name.questionClarification"])
  )
    return t(locale, "source.name.questionClarification");
  const builtIn =
    type === "text" || type === "correction" || type === "audio"
      ? builtInSourceNames[type]
      : null;
  return builtIn?.values.has(name) ? t(locale, builtIn.key) : name;
}

export function formatProjectCount(locale: Locale, count: number): string {
  if (locale === "en")
    return t(
      locale,
      count === 1 ? "projects.count.one" : "projects.count.many",
      {
        count,
      },
    );
  const category = new Intl.PluralRules("ru-RU").select(count);
  const key =
    category === "one"
      ? "projects.count.one"
      : category === "few"
        ? "projects.count.few"
        : "projects.count.many";
  return t(locale, key, { count });
}
