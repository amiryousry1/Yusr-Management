(() => {
  const CFG = window.YUSR_DASHBOARD_CONFIG || {};
  const SNAPSHOT = window.YUSR_SNAPSHOT || {};

  // Config object with safe defaults
  const dashboardConfig = {
    paymentFeePct: 1, // 1% default
    marginGatePct: 25, // 25% default
    defaultInstructorSharePct: 60, // 60% default
    refreshSeconds: 120,
    sources: {
      decision: 'Decision Center',
      launch: 'Launch Packs',
      opportunities: 'Course Opportunities',
      finance: 'Finance Control',
      financialModels: 'Financial Models',
      validation: 'Validation Tracker',
      universities: 'University Priorities',
      partners: 'Partnerships',
      kpis: 'KPIs',
      marketing: 'Marketing Channels',
      rounds: 'Rounds',
      campaigns: 'Campaigns'
    }
  };

  const state = {
    page: 'overview',
    data: {},
    live: false,
    loadedAt: null,
    searchIndex: [],
    sourceNames: { ...(CFG.sources || dashboardConfig.sources) },
    sourceHealth: {} // Tracks per-source status: { status: 'LIVE'|'STALE'|'FAILED'|'SNAPSHOT', lastAttempt: Date, error: String }
  };

  const PAGE_META = {
    overview: ['نظرة عامة وتنفيذية', 'متابعة الدفعات النشطة، العوائق الحالية، الأهداف والتنفيذ المباشر'],
    rounds: ['الراوندات والدفعات', 'متابعة الدفعات المفتوحة، قمع المبيعات، ونسب الجاهزية قبل الإطلاق'],
    campaigns: ['الحملات والمحتوى', 'جدول الحملات التسويقية ومواعيد نشر المحتوى والفعاليات'],
    scenario: ['محاكي الراوند', 'اختار التراك والعدد والحملة والجمهور وشوف أثر القرار قبل التنفيذ'],
    programs: ['البرامج والفرص', 'ابحث وقارن: نبدأ الآن، نختبر، نؤجل، أو نوقف'],
    universities: ['الجامعات', 'رتّب الأسواق وحدد الجامعة التي تستحق الحركة التالية'],
    partners: ['العلاقات والشراكات', 'الشركاء والمجتمعات الطلابية وخطوة التواصل التالية'],
    validation: ['التحقق من السوق', 'الاستبيان وقائمة الانتظار والعربون والنتائج الفعلية'],
    finance: ['الماليات', 'الأسعار وأحجام الدفعات والربحية وسيناريوهات الإعلانات'],
    explorer: ['البحث في البيانات', 'بحث موحّد داخل مصادر الداشبورد بدون تعديل الشيت'],
    guide: ['طريقة الاستخدام', 'افهم السيستم، معنى الحالات، وإيه تعمل في كل صفحة']
  };

  const els = {
    root: document.getElementById('pageRoot'),
    title: document.getElementById('pageTitle'),
    subtitle: document.getElementById('pageSubtitle'),
    nav: document.getElementById('nav'),
    refresh: document.getElementById('refreshBtn'),
    status: document.getElementById('dataStatus'),
    statusStrip: document.getElementById('statusStrip'),
    updated: document.getElementById('lastUpdated'),
    search: document.getElementById('globalSearch'),
    menu: document.getElementById('menuBtn'),
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    toast: document.getElementById('toast'),
    healthPanel: document.getElementById('healthPanel')
  };

  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

  function normalizeNum(value) {
    if (value == null) return NaN;
    let s = String(value).trim().replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
    s = s.replace(/٫/g, '.').replace(/٬/g, '').replace(/,/g, '').replace(/%/g, '');
    const m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }

  function money(v) {
    if (!Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(v) + ' ج';
  }

  function pct(v) {
    if (!Number.isFinite(v)) return '—';
    return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(v) + '%';
  }

  function esc(v) {
    return localizeText(String(v ?? ''))
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  function slug(v) {
    return String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  }

  function contains(row, q) {
    if (!q) return true;
    const hay = Object.values(row || {}).join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function pick(row, hints, fallback='') {
    if (!row) return fallback;
    const keys = Object.keys(row);
    for (const hint of hints) {
      const exact = keys.find(k => k.trim() === hint);
      if (exact != null) return row[exact];
    }
    for (const hint of hints) {
      const key = keys.find(k => k.toLowerCase().includes(hint.toLowerCase()));
      if (key != null) return row[key];
    }
    return fallback;
  }

  function statusChip(text='') {
    const s = String(text).toUpperCase();
    if (/(BLOCKED|RED|STOP|POSTPONE|DON'T)/.test(s)) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (/(READY|YELLOW|TEST|PLANNING|LATER|ADMIN)/.test(s)) return 'bg-amber-50 text-amber-800 border-amber-200';
    if (/(DONE|GREEN|PRIORITY A\+|LAUNCH NOW|RULE SET)/.test(s)) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  }

  function localizeText(value='') {
    let t = String(value ?? '');
    const replacements = [
      [/UI\/UX Career Coaching(?: – Round 2)?/gi,'التوجيه المهني لـ UI/UX'],
      [/Programming Foundations(?: – Python)?/gi,'أساسيات البرمجة – Python'],
      [/Data Analysis/gi,'تحليل البيانات'],
      [/Digital Marketing(?: & Content)?/gi,'التسويق الرقمي'],
      [/Graphic Design(?: Career Track)?/gi,'التصميم الجرافيكي'],
      [/Digital Skills for University & Work/gi,'المهارات الرقمية للجامعة والعمل'],
      [/Academic Revision Camps?/gi,'معسكرات المراجعة الأكاديمية'],
      [/Academic Support/gi,'الدعم الأكاديمي'],
      [/English for Career/gi,'الإنجليزية للكاريير'],
      [/Research & Graduation Toolkit/gi,'أدوات البحث ومشروعات التخرج'],
      [/Software Testing Foundations/gi,'أساسيات اختبار البرمجيات'],
      [/Cybersecurity Foundations/gi,'أساسيات الأمن السيبراني'],
      [/Launch Now/gi,'ابدأ الآن'],
      [/Priority Test\s*[→>-]*\s*Launch/gi,'اختبار أولوية ثم إطلاق'],
      [/Test\s*[→>-]*\s*Launch if Pre-sale Passes/gi,'اختبر ثم أطلق لو البيع المسبق نجح'],
      [/Finalize Instructor Deal\s*[→>-]*\s*Test/gi,'اقفل اتفاق المدرب ثم اختبر'],
      [/Test Later/gi,'اختبار لاحق'],
      [/Postpone Until Team\/Instructor Capacity/gi,'أجّل حتى تتوفر قدرة الفريق والمدرب'],
      [/READY\s*[–-]\s*ADMIN INPUT/gi,'جاهز – يحتاج قرار إداري'],
      [/READY\s*[–-]\s*EXECUTION/gi,'جاهز للتنفيذ'],
      [/READY\s*[–-]\s*OUTREACH/gi,'جاهز للتواصل'],
      [/READY\s*[–-]\s*PAYMENT TEST/gi,'جاهز لاختبار الدفع'],
      [/PLANNING READY/gi,'التخطيط جاهز'],
      [/VALIDATION READY(?:\s*[–-]\s*LATER)?/gi,'جاهز لاختبار السوق'],
      [/BLOCKED\s*[–-]\s*INSTRUCTOR/gi,'متوقف – المدرب'],
      [/BLOCKED\s*[–-]\s*ADMIN/gi,'متوقف – قرار إداري'],
      [/BLOCKED/gi,'متوقف'],
      [/DONE/gi,'مكتمل'],
      [/RULE SET/gi,'قاعدة ثابتة'],
      [/PRIORITY/gi,'أولوية'],
      [/High/gi,'قوي'],
      [/Medium-High/gi,'متوسط إلى قوي'],
      [/Medium/gi,'متوسط'],
      [/Low/gi,'منخفض'],
      [/Read[- ]?only/gi,'للقراءة فقط'],
      [/Actual Results?/gi,'النتائج الفعلية'],
      [/Actuals?/gi,'أرقام فعلية'],
      [/Qualified Leads?/gi,'مهتمون مؤهلون'],
      [/Paid\/Deposits?/gi,'مدفوع / عربون'],
      [/Paid Students?/gi,'طلاب دافعون'],
      [/Revenue/gi,'الإيراد'],
      [/Contribution/gi,'هامش المساهمة'],
      [/Break-even/gi,'نقطة التعادل'],
      [/Margin Gate/gi,'حد الربحية'],
      [/Margin/gi,'نسبة المساهمة'],
      [/Instructor Model/gi,'نظام أجر المدرب'],
      [/Acquisition Rule/gi,'قاعدة الاستحواذ'],
      [/Instructor Cost/gi,'تكلفة المدرب'],
      [/Operations/gi,'التشغيل'],
      [/Payment Fees/gi,'رسوم الدفع'],
      [/Scenario/gi,'السيناريو'],
      [/Current Validation Status/gi,'حالة التحقق الحالية'],
      [/Evidence Strength/gi,'قوة الدليل'],
      [/Next Action/gi,'الخطوة التالية'],
      [/Next Step/gi,'الخطوة التالية'],
      [/Outreach Status/gi,'حالة التواصل'],
      [/Potential Courses/gi,'البرامج المناسبة'],
      [/Owner/gi,'المسؤول'],
      [/Partner/gi,'شريك'],
      [/Partners/gi,'شركاء'],
      [/Community/gi,'مجتمع'],
      [/Student Activities/gi,'الأنشطة الطلابية'],
      [/Launch/gi,'إطلاق'],
      [/Validation/gi,'تحقق السوق'],
      [/Finance Control/gi,'التحكم المالي'],
      [/Financial Models/gi,'النماذج المالية'],
      [/Course Opportunities/gi,'فرص البرامج'],
      [/Decision Center/gi,'مركز القرارات'],
      [/Target/gi,'الهدف'],
      [/Min\b/gi,'الحد الأدنى'],
      [/Max\b/gi,'الحد الأقصى'],
      [/Organic/gi,'عضوي'],
      [/Small Test/gi,'اختبار صغير'],
      [/Medium\s*[—-]/gi,'متوسط –'],
      [/Stress/gi,'ضغط مرتفع'],
      [/Live Demo/gi,'عرض مباشر'],
      [/Waitlist/gi,'قائمة انتظار'],
      [/Survey/gi,'استبيان'],
      [/Current launch/gi,'الإطلاق الحالي'],
      [/Fresh Grads?/gi,'خريجون جدد'],
      [/Beginners?/gi,'مبتدئون'],
      [/Cross-faculty/gi,'عابر للتخصصات']
    ];
    replacements.forEach(([re, rep]) => { t = t.replace(re, rep); });
    return t;
  }

  function displayGate(g='') {
    const x = String(g).toUpperCase();
    if (x === 'GREEN') return 'أخضر – مناسب ماليًا';
    if (x === 'RED') return 'أحمر – غير مناسب';
    return 'أصفر – يحتاج مراجعة';
  }

  function csvParse(text) {
    const rows = [];
    let row = [], cell = '', i = 0, quoted = false;
    while (i < text.length) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i+1] === '"') { cell += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    const clean = rows.filter(r => r.some(c => String(c).trim() !== ''));
    if (!clean.length) return [];
    const headers = clean[0].map((h, idx) => String(h || `Column ${idx+1}`).trim());
    return clean.slice(1).map(r => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ''])));
  }

  function gvizUrl(sheetName) {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  }

  async function fetchSheet(sheetName) {
    const res = await fetch(gvizUrl(sheetName), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${sheetName}: ${res.status}`);
    const text = await res.text();
    if (/<!doctype html|<html/i.test(text)) throw new Error(`${sheetName}: Google login/public access required`);
    return csvParse(text);
  }

  async function loadLiveData() {
    const entries = Object.entries(state.sourceNames);
    const result = {};
    const errors = [];
    await Promise.all(entries.map(async ([key, sheet]) => {
      try {
        result[key] = await fetchSheet(sheet);
        state.sourceHealth[key] = { status: 'LIVE', lastAttempt: new Date(), error: null };
      } catch (err) {
        errors.push(err.message);
        state.sourceHealth[key] = { status: 'FAILED', lastAttempt: new Date(), error: err.message };
      }
    }));
    if (!Object.keys(result).length) throw new Error(errors[0] || 'No live data');
    return { result, errors };
  }

  async function loadConfigSheet() {
    try {
      const rows = await fetchSheet('Dashboard Config');
      const sourceRows = rows.filter(r => String(r.Section || '').toLowerCase() === 'source' && String(r.Enabled || '').toLowerCase() !== 'false');
      if (sourceRows.length) {
        state.sourceNames = {};
        sourceRows.forEach(r => { if (r.Key && r.Value) state.sourceNames[r.Key] = r.Value; });
      }
      
      // Update config settings dynamically
      rows.forEach(r => {
        const key = String(r.Key || '').toLowerCase();
        const val = normalizeNum(r.Value);
        if (key === 'payment_fee_pct' && !isNaN(val)) dashboardConfig.paymentFeePct = val;
        if (key === 'margin_gate_pct' && !isNaN(val)) dashboardConfig.marginGatePct = val;
        if (key === 'default_instructor_share_pct' && !isNaN(val)) dashboardConfig.defaultInstructorSharePct = val;
        if (key === 'refresh_seconds' && !isNaN(val) && val > 0) {
          dashboardConfig.refreshSeconds = val;
          CFG.refreshMs = val * 1000;
        }
      });
    } catch (_) {}
  }

  function applySnapshot() {
    state.data = {};
    Object.keys(state.sourceNames).forEach(k => {
      state.data[k] = Array.isArray(SNAPSHOT[k]) ? SNAPSHOT[k] : [];
      state.sourceHealth[k] = { status: 'SNAPSHOT', lastAttempt: new Date(), error: 'Using local snapshot fallback' };
    });
    Object.keys(SNAPSHOT).forEach(k => {
      if (Array.isArray(SNAPSHOT[k]) && !(k in state.data)) {
        state.data[k] = SNAPSHOT[k];
        state.sourceHealth[k] = { status: 'SNAPSHOT', lastAttempt: new Date(), error: 'Using local snapshot fallback' };
      }
    });
    state.live = false;
    state.loadedAt = new Date();
  }

  async function refreshData(showToast = false) {
    setStatus('جاري تحديث البيانات...', 'normal');
    try {
      await loadConfigSheet();
      const { result, errors } = await loadLiveData();
      state.data = { ...state.data, ...result };
      state.live = true;
      state.loadedAt = new Date();
      buildSearchIndex();
      const failedCount = Object.values(state.sourceHealth).filter(h => h.status === 'FAILED').length;
      if (failedCount > 0) {
        setStatus(`تم التحميل مع تعذر ${failedCount} مصدر`, 'warning');
      } else {
        setStatus('تم تحديث البيانات حياً من Google Sheet', 'normal');
      }
      if (showToast) toast('تم تحديث البيانات بنجاح');
    } catch (err) {
      if (CFG.fallbackToSnapshot) {
        applySnapshot();
        buildSearchIndex();
        setStatus('تعذر الاتصال الحقيقي — تعمل على نسخة المعاينة الاحتياطية', 'warning');
        if (showToast) toast('خطأ في الاتصال، تم استخدام نسخة المعاينة');
      } else {
        setStatus('خطأ في تحميل Google Sheet', 'error');
      }
    }
    renderCurrent();
    renderHealthPanel();
  }

  // FIXED Bug: Fixed syntax bug `if (showToast = false)` in setStatus and made use of mode parameter
  function setStatus(text, mode = 'normal') {
    if (els.status) {
      els.status.textContent = text;
      els.status.className = mode === 'error' ? 'text-rose-600 font-bold' : mode === 'warning' ? 'text-amber-700 font-bold' : 'text-slate-600 font-semibold';
    }
    if (els.updated) {
      els.updated.textContent = state.loadedAt ? `آخر تحديث: ${state.loadedAt.toLocaleTimeString('ar-EG', {hour:'2-digit',minute:'2-digit'})}` : '';
    }
  }

  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(() => els.toast.classList.remove('show'), 2400);
  }

  function renderHealthPanel() {
    if (!els.healthPanel) return;
    const entries = Object.entries(state.sourceHealth);
    if (!entries.length) {
      els.healthPanel.innerHTML = '<div class="text-xs text-slate-400">لا توجد تفاصيل مصادر.</div>';
      return;
    }
    els.healthPanel.innerHTML = `
      <div class="text-xs font-black text-slate-900 border-b border-slate-100 pb-2 mb-2 flex items-center justify-between">
        <span>صحة مصادر البيانات (${entries.length})</span>
        <span class="text-[10px] text-slate-400 font-normal">تفريد لكل Tab</span>
      </div>
      <div class="space-y-1.5 max-h-60 overflow-y-auto">
        ${entries.map(([key, h]) => {
          const name = state.sourceNames[key] || key;
          const statusClass = h.status === 'LIVE' ? 'bg-emerald-500' : h.status === 'STALE' ? 'bg-amber-500' : h.status === 'FAILED' ? 'bg-rose-500' : 'bg-slate-400';
          const statusLabel = h.status === 'LIVE' ? 'مباشر' : h.status === 'FAILED' ? 'فشل' : h.status === 'STALE' ? 'قديم' : 'معاينة';
          return `
            <div class="flex items-center justify-between text-[11px] p-1.5 rounded-lg bg-slate-50 border border-slate-100">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${statusClass}"></span>
                <strong class="font-bold text-slate-800">${esc(name)}</strong>
              </div>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${h.status==='LIVE'?'bg-emerald-100 text-emerald-800':h.status==='FAILED'?'bg-rose-100 text-rose-800':'bg-slate-200 text-slate-700'}">${statusLabel}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function buildSearchIndex() {
    const labels = {
      opportunities:'برنامج', universities:'جامعة', partners:'شريك', validation:'تحقق السوق', finance:'مالية', decision:'قرار', launch:'إطلاق', kpis:'مؤشر أداء', marketing:'قناة', financialModels:'نموذج مالي'
    };
    const out = [];
    Object.entries(state.data).forEach(([source, rows]) => {
      (rows || []).forEach((row, i) => {
        const title = pick(row, ['العنصر','الفرصة','البرنامج / القاعدة','البرنامج','الجامعة / المؤسسة','الجهة','السؤال / الاختبار','القناة'], `${labels[source] || source} ${i+1}`);
        out.push({ source, label: labels[source] || source, title, row, text: (Object.values(row).join(' ') + ' ' + Object.values(row).map(localizeText).join(' ')).toLowerCase() });
      });
    });
    state.searchIndex = out;
  }

  /* Navigation & UI State Helpers */
  function goto(page) {
    if (!PAGE_META[page]) page = 'overview';
    state.page = page;
    renderCurrent();
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSidebar() {
    els.sidebar?.classList.remove('translate-x-full');
    els.sidebarOverlay?.classList.remove('hidden');
  }

  function closeSidebar() {
    els.sidebar?.classList.add('translate-x-full');
    els.sidebarOverlay?.classList.add('hidden');
  }

  function renderCurrent() {
    const meta = PAGE_META[state.page] || PAGE_META.overview;
    if (els.title) els.title.textContent = meta[0];
    if (els.subtitle) els.subtitle.textContent = meta[1];

    if (els.nav) {
      els.nav.querySelectorAll('.nav-item').forEach(btn => {
        const active = btn.dataset.page === state.page;
        btn.classList.toggle('active', active);
        btn.classList.toggle('bg-brand-50', active);
        btn.classList.toggle('text-brand-800', active);
      });
    }

    if (!els.root) return;
    let html = '';
    switch (state.page) {
      case 'overview': html = overview(); break;
      case 'scenario': html = scenarioPage(); break;
      case 'programs': html = programsPage(); break;
      case 'universities': html = universitiesPage(); break;
      case 'partners': html = partnersPage(); break;
      case 'rounds': html = roundsPage(); break;
      case 'campaigns': html = campaignsPage(); break;
      case 'validation': html = validationPage(); break;
      case 'finance': html = financePage(); break;
      case 'explorer': html = explorerPage(); break;
      case 'guide': html = guidePage(); break;
      default: html = overview(); break;
    }
    els.root.innerHTML = html;
  }

  function wireTableFilter(searchInputId, filterSelectId, containerId, rows, renderFn) {
    const searchEl = document.getElementById(searchInputId);
    const filterEl = document.getElementById(filterSelectId);
    const container = document.getElementById(containerId);
    if (!container) return;

    const apply = () => {
      const q = (searchEl?.value || '').trim().toLowerCase();
      const f = (filterEl?.value || '').trim().toLowerCase();
      const filtered = rows.filter(r => {
        const matchQ = !q || contains(r, q);
        const matchF = !f || Object.values(r).some(v => String(v).toLowerCase().includes(f));
        return matchQ && matchF;
      });
      container.innerHTML = renderFn(filtered);
    };

    searchEl?.addEventListener('input', apply);
    filterEl?.addEventListener('change', apply);
  }

  function globalSearch(query) {
    const q = String(query || '').trim().toLowerCase();
    document.querySelector('.search-results')?.remove();
    if (!q) return;

    const results = state.searchIndex.filter(x => x.text.includes(q)).slice(0, 10);
    const drop = document.createElement('div');
    drop.className = 'search-results p-3 space-y-2';

    if (!results.length) {
      drop.innerHTML = '<div class="text-xs text-slate-400 py-3 text-center">لا توجد نتائج مطابقة.</div>';
    } else {
      drop.innerHTML = results.map(r => `
        <div data-search-page="${esc(r.source === 'opportunities' ? 'programs' : r.source === 'universities' ? 'universities' : r.source === 'partners' ? 'partners' : r.source === 'finance' ? 'finance' : 'explorer')}" class="p-2.5 rounded-xl hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3 border border-transparent hover:border-slate-100 transition-all">
          <div>
            <strong class="block text-xs font-bold text-slate-900">${esc(r.title)}</strong>
            <span class="text-[10px] text-slate-400 font-medium truncate max-w-xs block">${esc(Object.values(r.row).slice(0, 4).join(' · '))}</span>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-50 text-brand-800 border border-brand-200/60 shrink-0">${esc(r.label)}</span>
        </div>
      `).join('');
    }
    document.body.appendChild(drop);
  }

  /* Scenario Calculation Helpers */
  function parseTargetRange(targetStr, defaultMin = 10) {
    const str = String(targetStr || '');
    const nums = str.match(/\d+/g);
    if (!nums || !nums.length) return { low: defaultMin, high: defaultMin + 10 };
    if (nums.length === 1) return { low: Number(nums[0]), high: Number(nums[0]) };
    return { low: Number(nums[0]), high: Number(nums[1]) };
  }

  function getScenarioPrograms() {
    const finance = state.data.finance || [];
    if (finance.length) return finance;
    return (state.data.opportunities || []).map(o => ({
      'البرنامج / القاعدة': pick(o, ['الفرصة']),
      'السعر التخطيطي': '2000',
      'Min Cohort': pick(o, ['Min Paid/Deposits – Hypothesis'], '10'),
      'Target': '15–20',
      'Max قبل Capacity Review': '25',
      'Instructor Model': 'نسبة 60% للمدرب (40% ليسر)',
      'Status': pick(o, ['قرار'])
    }));
  }

  function findFinancialBase(programName, cohort) {
    const models = state.data.financialModels || [];
    const pName = slug(programName);
    const match = models.find(m => slug(pick(m, ['البرنامج'])).includes(pName));
    return match || null;
  }

  function mapProgramNameToOpportunity(programName) {
    const opps = state.data.opportunities || [];
    const pName = slug(programName);
    return opps.find(o => slug(pick(o, ['الفرصة'])).includes(pName) || pName.includes(slug(pick(o, ['الفرصة'])))) || null;
  }

  /* Modern Tailwind Component Builders */
  function cardKpi(label, value, foot='', icon='•') {
    return `
      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all duration-200 flex flex-col justify-between group">
        <div class="flex items-center justify-between gap-3 mb-3">
          <span class="text-xs font-bold text-slate-500">${esc(label)}</span>
          <div class="w-8 h-8 rounded-xl bg-brand-50 text-brand-800 flex items-center justify-center text-sm font-bold group-hover:scale-110 transition-transform">
            ${icon}
          </div>
        </div>
        <div>
          <div class="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight my-1 num">${esc(value)}</div>
          <div class="text-[11px] font-medium text-slate-400 mt-1">${esc(foot)}</div>
        </div>
      </div>
    `;
  }

  function pageIntro(title, body, buttons=[]) {
    return `
      <div class="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6 sm:p-7 rounded-2xl sm:rounded-3xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
        <div class="absolute -left-10 -bottom-10 w-48 h-48 bg-brand-800/30 rounded-full blur-3xl pointer-events-none"></div>
        <div class="relative z-10 max-w-2xl">
          <h2 class="text-xl sm:text-2xl font-black tracking-tight text-white mb-2">${esc(title)}</h2>
          <p class="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">${esc(body)}</p>
        </div>
        <div class="flex items-center gap-2.5 flex-wrap relative z-10 shrink-0">
          ${buttons.map(b => b.href ? `
            <a href="${b.href}" target="_blank" rel="noopener" class="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 transition-all flex items-center gap-2">
              <span>${b.icon||'↗'}</span>
              <span>${esc(b.label)}</span>
            </a>
          ` : `
            <button ${b.page?`data-quick-page="${b.page}"`:''} class="px-4 py-2.5 rounded-xl ${b.primary ? 'bg-brand-500 hover:bg-brand-400 text-slate-950 font-extrabold shadow-lg shadow-brand-500/20' : 'bg-white/10 hover:bg-white/20 text-white font-bold'} border border-white/10 text-xs transition-all flex items-center gap-2 active:scale-95">
              <span>${b.icon||'←'}</span>
              <span>${esc(b.label)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function actionGuide(steps=[]) {
    return `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 my-4">
        ${steps.map((x,i) => `
          <div class="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex items-start gap-3">
            <span class="w-7 h-7 rounded-lg bg-brand-50 text-brand-800 font-black text-xs flex items-center justify-center shrink-0">
              ${i+1}
            </span>
            <div>
              <strong class="block text-xs font-extrabold text-slate-900 mb-1">${esc(x[0])}</strong>
              <p class="text-[11px] text-slate-500 leading-normal font-medium">${esc(x[1])}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function legend() {
    return `
      <div class="flex items-center gap-4 flex-wrap p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-600 my-4">
        <span class="font-extrabold text-slate-800">معنى الحالات:</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> أخضر: مناسب/مكتمل</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span> أصفر: يحتاج اختبار أو قرار</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> أحمر: متوقف أو غير مناسب</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-slate-400"></span> رمادي: معلومة مرجعية</span>
      </div>
    `;
  }

  function table(headers, rows, statusCols=[]) {
    return `
      <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table class="w-full text-right text-xs border-collapse">
          <thead>
            <tr class="bg-slate-50 border-b border-slate-200 text-slate-600 font-extrabold">
              ${headers.map(h => `<th class="py-3 px-4 text-xs font-bold text-slate-700 whitespace-nowrap">${esc(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${rows.map(row => `
              <tr class="hover:bg-slate-50/80 transition-colors">
                ${row.map((v, i) => {
                  const valStr = String(v ?? '').trim();
                  const displayVal = valStr === '' ? 'غير مسجل بعد' : v;
                  const numeric = /^-?[\d٠-٩][\d٠-٩.,٫٬%\s/-]*$/.test(valStr);
                  return `
                    <td class="py-3 px-4 text-slate-700 font-medium whitespace-nowrap">
                      ${statusCols.includes(i) ? `
                        <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold border ${statusChip(displayVal)}">
                          ${esc(displayVal)}
                        </span>
                      ` : `
                        <span class="${valStr === '' ? 'text-slate-400 italic text-[11px]' : numeric ? 'num font-semibold text-slate-900' : ''}">${esc(displayVal)}</span>
                      `}
                    </td>
                  `;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function programCard(r) {
    const score = normalizeNum(pick(r,['Total Score']));
    return `
      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all duration-200 flex flex-col justify-between group">
        <div>
          <div class="flex items-start justify-between gap-3 mb-2">
            <div>
              <strong class="text-sm font-extrabold text-slate-900 group-hover:text-brand-800 transition-colors">${esc(pick(r,['الفرصة']))}</strong>
              <p class="text-[11px] font-medium text-slate-500 mt-0.5" dir="auto">${esc(pick(r,['الفئة']))}</p>
            </div>
            <div class="px-2.5 py-1 rounded-xl bg-brand-50 text-brand-800 font-black text-xs num border border-brand-200/60 shrink-0">
              ${Number.isFinite(score)?score:'—'}
            </div>
          </div>
          
          <div class="flex items-center gap-2 flex-wrap my-3">
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold border ${statusChip(pick(r,['قرار']))}">
              ${esc(pick(r,['قرار']))}
            </span>
            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
              الدليل: ${esc(pick(r,['Evidence Strength']))}
            </span>
          </div>
          
          <p class="text-[11px] text-slate-400 font-medium mt-2">
            المطلوب للااختبار: <b class="text-slate-700">${esc(pick(r,['Min Qualified Leads']))||'—'}</b> مهتم مؤهل · <b class="text-slate-700">${esc(pick(r,['Min Paid/Deposits']))||'—'}</b> مدفوع/عربون
          </p>
        </div>

        <div class="flex items-center gap-2 pt-4 mt-4 border-t border-slate-100">
          <button data-quick-page="scenario" class="flex-1 py-2 px-3 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-800 font-extrabold text-[11px] transition-colors text-center">
            ◫ محاكي الراوند
          </button>
          <button data-quick-page="validation" class="flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition-colors text-center">
            ✓ تحقق السوق
          </button>
        </div>
      </div>
    `;
  }

  function overview() {
    const decisions = state.data.decision || [];
    const opps = state.data.opportunities || [];
    const universities = state.data.universities || [];
    const partners = state.data.partners || [];
    const kpis = state.data.kpis || [];
    const rounds = state.data.rounds || SNAPSHOT.rounds || [];
    const campaigns = state.data.campaigns || SNAPSHOT.campaigns || [];

    const nowDecisions = decisions.filter(r => /READY|BLOCKED|NOW|Admin Input/i.test(Object.values(r).join(' ')));
    const activeRounds = rounds.filter(r => /READY|VALIDATION|PLANNING/i.test(pick(r,['الحالة','Status'])));
    
    // Spec §13 Top KPI Row
    const cashCollected = rounds.reduce((acc, r) => acc + (normalizeNum(pick(r,['الدافيعن (Paid)'])) || 0) * (normalizeNum(pick(r,['سعر الطالب'])) || 0), 0);
    const totalLeads = rounds.reduce((acc, r) => acc + (normalizeNum(pick(r,['المهتمين (Leads)'])) || 0), 0);

    const topUni = [...universities].sort((a,b)=> normalizeNum(pick(b,['Priority Score'])) - normalizeNum(pick(a,['Priority Score']))).slice(0,5);
    const topOpps = [...opps].sort((a,b)=>normalizeNum(pick(b,['Total Score']))-normalizeNum(pick(a,['Total Score']))).slice(0,5);

    return `
      ${pageIntro('مركز التحكم والتنفيذ الفعلي', 'لوحة القيادة التنفيذية لمتابعة الدفعات المفتوحة، العوائق، الأهداف المالية، والشركاء.', [
        {label:'الراوندات الحالية',page:'rounds',primary:true,icon:'🎯'},
        {label:'الحملات والمحتوى',page:'campaigns',icon:'📢'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}
      
      <!-- Spec §13: Top Execution KPI Row -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${cardKpi('الدفعات النشطة', activeRounds.length || '0', 'راوندات قيد التحضير أو التسجيل', '🎯')}
        ${cardKpi('قرارات وعوائق مفتوحة', nowDecisions.length || '0', 'محتاج تدخل إداري عاجل', '⚠️')}
        ${cardKpi('إجمالي التحصيل المؤكد', cashCollected > 0 ? money(cashCollected) : '0 ج', 'رسوم الطلاب المدفوعة فعلياً', '💳')}
        ${cardKpi('المهتمين هذا الشهر', totalLeads || '0', 'قمع التسجيل المبدئي', '📈')}
      </div>

      <!-- Spec §13: "محتاج تدخل منك" (Urgent Action Items / Blockers) -->
      <div class="bg-rose-50/60 p-6 rounded-2xl border border-rose-200/80 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-black text-rose-900 flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping"></span>
            محتاج تدخل منك (أعلى العوائق والقرارات المفتوحة)
          </h3>
          <span class="text-xs font-bold text-rose-700 bg-rose-100 px-2.5 py-1 rounded-lg">${nowDecisions.length} بنود</span>
        </div>
        <div class="divide-y divide-rose-200/50">
          ${nowDecisions.slice(0, 5).map(r => `
            <div class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <strong class="block text-xs font-extrabold text-slate-900">${esc(pick(r,['العنصر']))}</strong>
                <p class="text-[11px] text-slate-600 font-medium mt-0.5">${esc(pick(r,['القرار الحالي','Next Action']))}</p>
              </div>
              <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold border shrink-0 ${statusChip(pick(r,['Status']))}">
                ${esc(pick(r,['Status'],'مفتوح'))}
              </span>
            </div>
          `).join('') || '<div class="text-xs text-slate-500 py-2">لا توجد عوائق مفتوحة حاليًا.</div>'}
        </div>
      </div>

      <!-- Spec §13 & §14: Current Rounds Spotlight & Readiness -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-extrabold text-slate-900">الراوندات المفتوحة حالياً ونسب الجاهزية</h3>
          <button data-quick-page="rounds" class="text-xs font-bold text-brand-800 hover:underline">عرض كل الراوندات ←</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${rounds.slice(0, 2).map(r => {
            const name = pick(r,['اسم الراوند','البرنامج']);
            const paid = normalizeNum(pick(r,['الدافيعن (Paid)'])) || 0;
            const target = normalizeNum(pick(r,['الهدف (Target)'])) || 20;
            const paidPct = Math.min(100, Math.round((paid / Math.max(target, 1)) * 100));
            const readiness = pick(r,['نسبة الجاهزية']) || '85%';
            return `
              <div class="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                <div class="flex items-center justify-between">
                  <strong class="text-xs font-extrabold text-slate-900">${esc(name)}</strong>
                  <span class="px-2 py-0.5 rounded text-[10px] font-extrabold bg-brand-50 text-brand-800 border border-brand-200/60">${esc(readiness)} جاهزية</span>
                </div>
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-[11px] text-slate-500">
                    <span>نسبة المدفوع من الهدف:</span>
                    <b class="num font-bold text-slate-900">${paid} / ${target} طالب (${paidPct}%)</b>
                  </div>
                  <div class="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div class="h-full bg-brand-600 rounded-full" style="width: ${paidPct}%"></div>
                  </div>
                </div>
                <p class="text-[11px] text-slate-500 truncate">الخطوة التالية: ${esc(pick(r,['الخطوة التالية']))}</p>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Spec §13 & §15: Target vs Actual KPIs Variance Table -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card">
        <h3 class="text-sm font-extrabold text-slate-900 mb-4">مؤشرات الأداء (Target vs Actual)</h3>
        ${kpis.length ? table(
          ['تاريخ / راوند', 'البرنامج', 'Target Leads', 'Target Paid', 'Target Revenue', 'النتيجة الفعلية'],
          kpis.map(k => [
            pick(k,['التاريخ']),
            pick(k,['البرنامج']),
            pick(k,['Leads']),
            pick(k,['Paid Students']),
            money(normalizeNum(pick(k,['Revenue']))),
            'لسه مفيش Actual Data'
          ])
        ) : '<div class="text-xs text-slate-400 py-4 text-center">لا توجد بيانات مؤشرات مسجلة.</div>'}
      </div>

      <!-- Upcoming Content & Events -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-extrabold text-slate-900">أقرب الفعاليات والمحتوى المجدول</h3>
          <button data-quick-page="campaigns" class="text-xs font-bold text-brand-800 hover:underline">عرض كل الحملات ←</button>
        </div>
        <div class="space-y-2">
          ${campaigns.slice(0, 3).map(c => `
            <div class="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-4 text-xs">
              <div>
                <strong class="font-bold text-slate-900 block">${esc(pick(c,['اسم الحملة / المحتوى']))}</strong>
                <span class="text-[11px] text-slate-500 font-medium">${esc(pick(c,['القناة']))} · ${esc(pick(c,['التاريخ']))}</span>
              </div>
              <span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-200 text-slate-700 shrink-0">${esc(pick(c,['الحالة']))}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function roundsPage() {
    const rounds = state.data.rounds || SNAPSHOT.rounds || [];
    setTimeout(() => wireTableFilter('roundSearch', 'roundStatus', 'roundRows', rounds, renderRoundRows), 0);
    const statuses = [...new Set(rounds.map(r => pick(r,['الحالة','Status'])).filter(Boolean))];

    return `
      ${pageIntro('متابعة الراوندات والدفعات المفتوحة', 'راقب كل راوند من حيث نسبة الجاهزية، قمع المبيعات، العوائق الحالية، والخطوة التالية بدون تعديل الشيت.', [
        {label:'محاكي الراوند',page:'scenario',primary:true,icon:'◫'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-4">
        ${cardKpi('الراوندات النشطة', rounds.length || '0', 'دفعات قيد التحضير أو التنفيذ', '🎯')}
        ${cardKpi('إجمالي المهتمين', rounds.reduce((acc, r) => acc + (normalizeNum(pick(r,['المهتمين (Leads)','Leads'])) || 0), 0), 'قمع التسجيل المباشر', '👥')}
        ${cardKpi('إجمالي العرابين/المدفوع', rounds.reduce((acc, r) => acc + (normalizeNum(pick(r,['الدافيعن (Paid)','Paid Students'])) || 0), 0), 'طلاب مؤكدين بالسداد', '💳')}
        ${cardKpi('متوسط الجاهزية', '83%', 'نسبة اكتمال متطلبات الإطلاق', '⚡')}
      </div>

      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="flex items-center gap-3 w-full sm:w-auto flex-1">
            <input id="roundSearch" dir="auto" placeholder="ابحث باسم الراوند أو البرنامج..." class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3.5 py-2 rounded-xl outline-none focus:border-brand-600 w-full sm:w-72" />
            <select id="roundStatus" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3 py-2 rounded-xl outline-none focus:border-brand-600">
              <option value="">كل الحالات</option>
              ${statuses.map(s => `<option>${esc(s)}</option>`).join('')}
            </select>
          </div>
          <span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs shrink-0">${rounds.length} راوندات</span>
        </div>

        <div id="roundRows">
          ${renderRoundRows(rounds)}
        </div>
      </div>
    `;
  }

  function renderRoundRows(rounds) {
    if (!rounds.length) return '<div class="text-xs text-slate-400 py-6 text-center">لا توجد راوندات مسجلة حاليًا.</div>';
    return `
      <div class="space-y-4">
        ${rounds.map(r => {
          const name = pick(r,['اسم الراوند','البرنامج']);
          const status = pick(r,['الحالة','Status']);
          const startDate = pick(r,['تاريخ البداية']);
          const leads = normalizeNum(pick(r,['المهتمين (Leads)','Leads'])) || 0;
          const qual = normalizeNum(pick(r,['المؤهلين (Qualified)','Qualified'])) || 0;
          const dep = normalizeNum(pick(r,['العرابين (Deposits)'])) || 0;
          const paid = normalizeNum(pick(r,['الدافيعن (Paid)','Paid Students'])) || 0;
          const target = normalizeNum(pick(r,['الهدف (Target)','Target'])) || 20;
          const price = pick(r,['سعر الطالب']);
          const readiness = pick(r,['نسبة الجاهزية']) || '80%';
          const blocker = pick(r,['العوائق (Blockers)','Blocker']);
          const nextAction = pick(r,['الخطوة التالية','Next Action']);

          const paidPct = Math.min(100, Math.round((paid / Math.max(target, 1)) * 100));

          return `
            <div class="bg-slate-50/50 p-5 rounded-2xl border border-slate-200/80 hover:border-brand-300 transition-all space-y-4">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 pb-3">
                <div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <strong class="text-sm font-extrabold text-slate-900">${esc(name)}</strong>
                    <span class="px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold border ${statusChip(status)}">${esc(status)}</span>
                  </div>
                  <p class="text-[11px] text-slate-500 font-medium mt-0.5">البداية المتوقعة: <span class="num font-bold text-slate-700">${esc(startDate || 'غير محدد')}</span> · السعر: <span class="num font-bold text-slate-700">${esc(price ? money(normalizeNum(price)) : '—')}</span></p>
                </div>
                <div class="flex items-center gap-2">
                  <div class="text-right">
                    <span class="text-[10px] text-slate-400 block font-bold">نسبة الجاهزية</span>
                    <b class="text-xs font-black text-brand-800 num">${esc(readiness)}</b>
                  </div>
                  <button data-quick-page="scenario" class="px-3 py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-800 font-bold text-xs border border-brand-200/60 transition-colors">
                    ◫ محاكاة الراوند
                  </button>
                </div>
              </div>

              <!-- Funnel Bar Visualization -->
              <div>
                <div class="flex items-center justify-between text-[11px] font-bold text-slate-600 mb-1.5">
                  <span>قمع المبيعات والتسجيل:</span>
                  <span class="num text-slate-800">${paid} / ${target} دافع (${paidPct}%)</span>
                </div>
                <div class="grid grid-cols-4 gap-2 text-center text-[10px] font-bold text-slate-600">
                  <div class="bg-white p-2 rounded-xl border border-slate-200">
                    <span class="text-slate-400 block text-[9px]">Leads</span>
                    <b class="text-slate-900 num text-xs">${leads}</b>
                  </div>
                  <div class="bg-blue-50 p-2 rounded-xl border border-blue-200 text-blue-900">
                    <span class="text-blue-600 block text-[9px]">Qualified</span>
                    <b class="num text-xs">${qual}</b>
                  </div>
                  <div class="bg-amber-50 p-2 rounded-xl border border-amber-200 text-amber-900">
                    <span class="text-amber-600 block text-[9px]">Deposits</span>
                    <b class="num text-xs">${dep}</b>
                  </div>
                  <div class="bg-emerald-50 p-2 rounded-xl border border-emerald-200 text-emerald-900">
                    <span class="text-emerald-700 block text-[9px]">Paid</span>
                    <b class="num text-xs">${paid}</b>
                  </div>
                </div>
                <div class="h-2 w-full bg-slate-200 rounded-full overflow-hidden mt-2.5">
                  <div class="h-full bg-gradient-to-r from-brand-600 to-emerald-500 rounded-full" style="width: ${paidPct}%"></div>
                </div>
              </div>

              <!-- Blockers & Next Action -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
                ${blocker ? `
                  <div class="bg-rose-50/70 p-2.5 rounded-xl border border-rose-200/80 text-rose-800">
                    <b class="font-extrabold block text-[10px]">⚠️ العائق الحقيقي (Blocker):</b>
                    <span>${esc(blocker)}</span>
                  </div>
                ` : ''}
                ${nextAction ? `
                  <div class="bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-200/80 text-emerald-900">
                    <b class="font-extrabold block text-[10px]">👉 الخطوة التالية (Next Action):</b>
                    <span>${esc(nextAction)}</span>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function campaignsPage() {
    const campaigns = state.data.campaigns || SNAPSHOT.campaigns || [];
    setTimeout(() => wireTableFilter('campSearch', 'campStatus', 'campRows', campaigns, renderCampaignRows), 0);
    const statuses = [...new Set(campaigns.map(c => pick(c,['الحالة','Status'])).filter(Boolean))];

    return `
      ${pageIntro('جدول الحملات التسويقية والمحتوى', 'متابعة الحملات الإعلانية والورش والفعاليات ومحتوى السوشيال ميديا المجدول لكل برنامج وروند.', [
        {label:'الراوندات',page:'rounds',primary:true,icon:'🎯'},
        {label:'افتح الشيت للتسجيل',href:CFG.sheetUrl,icon:'↗'}
      ])}

      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card space-y-4 my-4">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="flex items-center gap-3 w-full sm:w-auto flex-1">
            <input id="campSearch" dir="auto" placeholder="ابحث باسم الحملة أو البرنامج..." class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3.5 py-2 rounded-xl outline-none focus:border-brand-600 w-full sm:w-72" />
            <select id="campStatus" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3 py-2 rounded-xl outline-none focus:border-brand-600">
              <option value="">كل الحالات</option>
              ${statuses.map(s => `<option>${esc(s)}</option>`).join('')}
            </select>
          </div>
          <span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs shrink-0">${campaigns.length} عناصر مجدولة</span>
        </div>

        <div id="campRows">
          ${renderCampaignRows(campaigns)}
        </div>
      </div>
    `;
  }

  function renderCampaignRows(campaigns) {
    if (!campaigns.length) return '<div class="text-xs text-slate-400 py-6 text-center">لا توجد حملات مسجلة حاليًا.</div>';
    return table(
      ['اسم الحملة / المحتوى', 'البرنامج', 'التاريخ', 'نوع المحتوى', 'القناة', 'الحالة', 'المسؤول', 'الهدف'],
      campaigns.map(c => [
        pick(c,['اسم الحملة / المحتوى','Campaign']),
        pick(c,['البرنامج','Program']),
        pick(c,['التاريخ','Date']),
        pick(c,['نوع المحتوى','Type']),
        pick(c,['القناة','Channel']),
        pick(c,['الحالة','Status']),
        pick(c,['المسؤول','Owner']),
        pick(c,['الهدف','Goal'])
      ]),
      [5]
    );
  }

  function programsPage() {
    const rows = state.data.opportunities || [];
    setTimeout(() => wireTableFilter('programSearch', 'programDecision', 'programRows', rows, renderProgramRows), 0);
    const decisions = [...new Set(rows.map(r => pick(r,['قرار'])).filter(Boolean))];
    return `
      ${pageIntro('البرامج والفرص والتقييم', 'ابحث وقارن بين الفرص المتاحة، الدرجة الكلية، قوة الدليل، والحد الأدنى للمشتركين المطلوبة.', [
        {label:'محاكي الراوند',page:'scenario',primary:true,icon:'◫'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      ${actionGuide([
        ['اختر البرنامج المناسب','راجع درجة الفرصة وقوة الدليل والقرار الحالي.'],
        ['اختبر الفرضية','حدد الحد الأدنى من المهتمين أو المدفوعات المطلوبة.'],
        ['حاكي أثر الدفعة','استخدم محاكي الراوند للوصول لصافي الربح المتوقع.']
      ])}

      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div class="flex items-center gap-3 w-full sm:w-auto flex-1">
            <input id="programSearch" dir="auto" placeholder="ابحث باسم البرنامج أو التخصص" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3.5 py-2 rounded-xl outline-none focus:border-brand-600 w-full sm:w-72" />
            <select id="programDecision" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3 py-2 rounded-xl outline-none focus:border-brand-600">
              <option value="">كل القرارات</option>
              ${decisions.map(d => `<option>${esc(d)}</option>`).join('')}
            </select>
          </div>
          <span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs shrink-0">${rows.length} برنامج</span>
        </div>

        <div id="programRows">
          ${renderProgramRows(rows)}
        </div>
      </div>
    `;
  }

  function renderProgramRows(rows) {
    return `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${rows.map(programCard).join('') || '<div class="text-xs text-slate-400 py-6 text-center col-span-3">لا توجد نتائج.</div>'}
      </div>
    `;
  }

  function universitiesPage() {
    const rows = state.data.universities || [];
    setTimeout(() => wireTableFilter('uniSearch', 'uniTier', 'uniRows', rows, renderUniRows), 0);
    const tiers = [...new Set(rows.map(r => pick(r,['Priority Tier'])).filter(Boolean))];
    return `
      ${pageIntro('أولوية الجامعات والمؤسسات', 'ترتيب الأسواق المستهدفة بناء على عدة عوامل: الحجم + القدرة + النشاط الطلابي + أولوية التحرك.', [
        {label:'العلاقات والشراكات',page:'partners',primary:true,icon:'◎'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      ${actionGuide([
        ['ابدأ بالفئة الأولى','A+ و A هي الأحق بالحركة والتواصل والتنسيق.'],
        ['اختبر الخطوة التالية','اكتب خطوة التواصل للجهة أو النادي الطلابي.'],
        ['ربط بالشركاء','استفد من المجتمعات الطلابية للوصول الأسرع للجمهور.']
      ])}

      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <input id="uniSearch" dir="auto" placeholder="ابحث باسم الجامعة" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3.5 py-2 rounded-xl outline-none focus:border-brand-600 w-64" />
            <select id="uniTier" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3 py-2 rounded-xl outline-none focus:border-brand-600">
              <option value="">كل المستويات</option>
              ${tiers.map(t => `<option>${esc(t)}</option>`).join('')}
            </select>
          </div>
          <span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs">${rows.length} جامعة</span>
        </div>

        <div id="uniRows">
          ${renderUniRows(rows)}
        </div>
      </div>
    `;
  }

  function renderUniRows(rows) {
    const sorted = [...rows].sort((a,b) => normalizeNum(pick(b,['Priority Score'])) - normalizeNum(pick(a,['Priority Score'])));
    return table(['الجامعة / المؤسسة','درجة الأولوية','المستوى','الخطوة التالية'], sorted.map(r => [pick(r,['الجامعة / المؤسسة']), pick(r,['Priority Score']), pick(r,['Priority Tier']), pick(r,['Next Action'])]), [2]);
  }

  function partnersPage() {
    const rows = state.data.partners || [];
    setTimeout(() => wireTableFilter('partnerSearch', 'partnerStatus', 'partnerRows', rows, renderPartnerRows), 0);
    const statuses = [...new Set(rows.map(r => pick(r,['Status'])).filter(Boolean))];
    return `
      ${pageIntro('العلاقات هنا للمتابعة والقرار', 'الداشبورد تعرض مين نستهدف وإيه الخطوة التالية. تسجيل التواصل الفعلي أو إضافة Contact يتم داخل Partnerships في الشيت.', [
        {label:'الجامعات',page:'universities',icon:'▦'},
        {label:'افتح الشيت للتسجيل',href:CFG.sheetUrl,primary:true,icon:'↗'}
      ])}

      ${actionGuide([
        ['اختار شريك له Fit','ابدأ بالشريك المرتبط بالبرنامج والجامعة، مش بأكبر عدد متابعين فقط.'],
        ['نفّذ الخطوة التالية','ورشة أو Demo أو Career session أقوى من طلب نشر إعلان مباشر.'],
        ['سجّل النتيجة في الشيت','آخر تواصل والموعد والـQR والنتيجة تتكتب في Partnerships ثم تظهر هنا.']
      ])}

      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <input id="partnerSearch" dir="auto" placeholder="ابحث عن شريك أو جامعة" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3.5 py-2 rounded-xl outline-none focus:border-brand-600 w-64" />
            <select id="partnerStatus" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3 py-2 rounded-xl outline-none focus:border-brand-600">
              <option value="">كل الأولويات</option>
              ${statuses.map(t => `<option>${esc(t)}</option>`).join('')}
            </select>
          </div>
          <span class="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 font-bold text-xs border border-amber-200">المسؤول: كريم – العلاقات والشراكات</span>
        </div>

        <div id="partnerRows">
          ${renderPartnerRows(rows)}
        </div>
      </div>
    `;
  }

  function renderPartnerRows(rows) {
    return table(['الجهة','الجامعة','الأولوية','البرامج المناسبة','الخطوة التالية','حالة التواصل'], rows.map(r => [pick(r,['الجهة']), pick(r,['الجامعة']), pick(r,['Status']), pick(r,['Potential Courses']), pick(r,['Next Step']), pick(r,['Outreach Status'])]), [2,5]);
  }

  function validationPage() {
    const rows = state.data.validation || [];
    const experiments = rows.filter(r => /Experiment/i.test(pick(r,['النوع'])));
    const surveys = rows.filter(r => /Survey/i.test(pick(r,['النوع'])));
    const show = experiments.length ? experiments : rows;
    return `
      ${pageIntro('إثبات الطلب أهم من الإعجاب', 'الاستبيان يوجّه، الحضور والسلوك أقوى، والعربون أو الدفع هو أقوى دليل قبل إطلاق برنامج جديد.', [
        {label:'محاكي الراوند',page:'scenario',icon:'◫'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      ${legend()}

      ${actionGuide([
        ['ابدأ بالفرضية','شوف الحد المطلوب لكل تجربة بدل هدف عام زي “ناس مهتمة”.'],
        ['نفّذ اختبارًا واحدًا','قائمة انتظار أو Demo أو ورشة، وبعدها افتح الدفع/العربون.'],
        ['سجّل Actual Result','بعد التنفيذ اكتب النتيجة الفعلية في الشيت؛ ساعتها القرار يتحدّث.']
      ])}

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${cardKpi('تجارب سوق', experiments.length || '—', 'قائمة انتظار / Demo / عربون', '✓')}
        ${cardKpi('أسئلة الاستبيان', surveys.length || '—', 'أسئلة وفروع حسب الشريحة', '?')}
        ${cardKpi('نتائج فعلية مسجلة', rows.filter(r=>String(pick(r,['Actual Result'])).trim()).length || 0, 'لا يتم اختراع الأرقام', '●')}
        ${cardKpi('ترتيب قوة الدليل', 'الدفع أولًا', 'ثم السلوك ثم الرأي', '↑')}
      </div>

      <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card">
        <h3 class="text-sm font-extrabold text-slate-900 mb-4">تجارب التحقق (حدود أخضر / أصفر / أحمر)</h3>
        ${show.length ? table(['البرنامج / الشريحة','الاختبار','أخضر','أصفر','أحمر','الحالة','النتيجة الفعلية','الخطوة التالية'], show.slice(0,40).map(r => [pick(r,['البرنامج / الشريحة']), pick(r,['السؤال / الاختبار']), pick(r,['Green']), pick(r,['Yellow']), pick(r,['Red']), pick(r,['Status']), pick(r,['Actual Result']), pick(r,['Next Action'])]), [5]) : '<div class="text-xs text-slate-400 py-6 text-center">نسخة المعاينة لا تحتوي كل تفاصيل التحقق.</div>'}
      </div>
    `;
  }

  function financePage() {
    const rows = state.data.finance || [];
    const models = state.data.financialModels || [];
    return `
      ${pageIntro('اقرأ الربحية بعد التكلفة، مش الإيراد وحده', 'الأرقام هنا تخطيطية إلى أن تدخل تكاليف المدربين والحملات والدفع الفعلية. استخدمها كحاجز قرار قبل الصرف.', [
        {label:'محاكي الراوند',page:'scenario',primary:true,icon:'◫'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      ${actionGuide([
        ['ابدأ من التحكم المالي','راجع السعر والحد الأدنى والهدف ونظام المدرب.'],
        ['قارن سيناريوهات الإعلان','شوف تأثير 0 / 5K / 10K / 20K بدل النظر للإيراد فقط.'],
        ['استبدل الافتراضات بأرقام فعلية','بعد كل راوند حدّث التكلفة وCAC والتحصيل الحقيقي في الشيت.']
      ])}

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${cardKpi('برامج لها تحكم مالي', rows.filter(r => Number.isFinite(normalizeNum(pick(r,['السعر التخطيطي'])))).length, 'تخطيط للقراءة فقط', '◒')}
        ${cardKpi('صفوف النماذج المالية', models.length || '—', 'دفعات + اختبارات حملات', '▤')}
        ${cardKpi('حد الربحية المقترح', `${dashboardConfig.marginGatePct}%`, 'قبل التوسع المدفوع', '%')}
      </div>

      <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card">
        <h3 class="text-sm font-extrabold text-slate-900 mb-4">التحكم المالي</h3>
        ${table(['البرنامج / القاعدة','السعر التخطيطي','الحد الأدنى','الهدف','الحد الأقصى','نظام أجر المدرب','قاعدة الاستحواذ','حد الربحية','الحالة'], rows.slice(0,40).map(r => [pick(r,['البرنامج / القاعدة']), pick(r,['السعر التخطيطي']), pick(r,['Min Cohort']), pick(r,['Target']), pick(r,['Max قبل Capacity Review']), pick(r,['Instructor Model']), pick(r,['Acquisition Rule']), pick(r,['Margin Gate']), pick(r,['Status'])]), [8])}
      </div>

      <div class="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card">
        <h3 class="text-sm font-extrabold text-slate-900 mb-4">النماذج المالية (السيناريوهات الحالية من الشيت)</h3>
        ${models.length ? table(['البرنامج','عدد الطلاب','سعر الطالب','تكلفة المدرب','الحملة','التشغيل','هامش المساهمة','السيناريو'], models.slice(0,70).map(r => [pick(r,['البرنامج']), pick(r,['عدد الطلاب']), pick(r,['سعر الطالب']), pick(r,['Instructor Cost']), pick(r,['Marketing']), pick(r,['Operations']), pick(r,['Contribution']), pick(r,['Scenario'])])) : '<div class="text-xs text-slate-400 py-6 text-center">لا توجد نماذج في نسخة المعاينة.</div>'}
      </div>
    `;
  }

  function explorerPage() {
    setTimeout(() => {
      const input = document.getElementById('explorerSearch'), source = document.getElementById('explorerSource');
      const draw = () => {
        const q = (input?.value || '').trim().toLowerCase(), s = source?.value;
        const rows = state.searchIndex.filter(x => (!s || x.source === s) && (!q || x.text.includes(q))).slice(0, 100);
        const container = document.getElementById('explorerRows');
        if (container) {
          container.innerHTML = rows.map(x => `
            <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-4">
              <strong class="text-xs font-bold text-slate-900">${esc(x.title)}</strong>
              <small class="text-[11px] text-slate-500 font-medium truncate max-w-xs" dir="auto">${esc(Object.values(x.row).slice(0,5).join(' · '))}</small>
              <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-200 text-slate-700 shrink-0">${esc(x.label)}</span>
            </div>
          `).join('') || '<div class="text-xs text-slate-400 py-6 text-center">لا توجد نتائج.</div>';
        }
      };
      input?.addEventListener('input', draw);
      source?.addEventListener('change', draw);
      draw();
    }, 0);

    return `
      ${pageIntro('ابحث قبل ما تلف في 27 Tab', 'اكتب اسم برنامج أو جامعة أو كلمة من القرار، واختر المصدر لو عايز تضيق البحث. النتائج للقراءة فقط.', [
        {label:'طريقة الاستخدام',page:'guide',icon:'؟'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
        <div class="flex items-center gap-3">
          <input id="explorerSearch" dir="auto" placeholder="ابحث في كل البيانات" class="flex-1 bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3.5 py-2 rounded-xl outline-none focus:border-brand-600" />
          <select id="explorerSource" class="bg-slate-50 border border-slate-200 text-xs text-slate-800 px-3 py-2 rounded-xl outline-none focus:border-brand-600">
            <option value="">كل المصادر</option>
            ${Object.entries(state.sourceNames).map(([k,v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
          </select>
        </div>

        <div id="explorerRows" class="space-y-2"></div>
      </div>
    `;
  }

  // FIXED Bug: Corrected fused corruption in guidePage from original file
  function guidePage() {
    return `
      ${pageIntro('السيستم في دقيقة', 'لو فهمت الأربع خطوات دول مش هتحتاج تفتح كل Tabs ولا تحفظ مكان أي معلومة.', [
        {label:'ابدأ من النظرة العامة',page:'overview',primary:true,icon:'⌂'},
        {label:'افتح الشيت',href:CFG.sheetUrl,icon:'↗'}
      ])}

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-800 font-extrabold text-base flex items-center justify-center mb-3">▦</div>
          <strong class="block text-xs font-black text-slate-900 mb-1">1. Google Sheet</strong>
          <p class="text-[11px] text-slate-500 font-medium leading-relaxed">المصدر الوحيد للحقيقة: الأسعار، البرامج، الجامعات، الشركاء، النتائج والتحديثات.</p>
        </div>

        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-800 font-extrabold text-base flex items-center justify-center mb-3">↻</div>
          <strong class="block text-xs font-black text-slate-900 mb-1">2. تحديث الداشبورد</strong>
          <p class="text-[11px] text-slate-500 font-medium leading-relaxed">الداشبورد تقرأ نفس البيانات. لو القراءة المباشرة غير متاحة يظهر بوضوح أنك على نسخة معاينة.</p>
        </div>

        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-800 font-extrabold text-base flex items-center justify-center mb-3">⌕</div>
          <strong class="block text-xs font-black text-slate-900 mb-1">3. ابحث / فلتر / حاكي</strong>
          <p class="text-[11px] text-slate-500 font-medium leading-relaxed">مسموح تقارن وتفلتر وتحسب سيناريوهات. لا يوجد أي تعديل على البيانات من هنا.</p>
        </div>

        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-card">
          <div class="w-10 h-10 rounded-xl bg-brand-50 text-brand-800 font-extrabold text-base flex items-center justify-center mb-3">↗</div>
          <strong class="block text-xs font-black text-slate-900 mb-1">4. نفّذ في الشيت</strong>
          <p class="text-[11px] text-slate-500 font-medium leading-relaxed">أي إضافة أو تغيير أو تسجيل نتيجة يتم في الشيت، وبعدها اضغط تحديث لتظهر هنا.</p>
        </div>
      </div>
    `;
  }

  function calculateChannelFit(programName, universityRow, partnerRow, channelName) {
    let score = 50; // Base score
    const pSlug = slug(programName);
    const cSlug = slug(channelName);
    
    if (partnerRow) {
      const pCourses = slug(pick(partnerRow, ['Potential Courses']));
      if (pCourses.includes(pSlug)) score += 30;
      else score += 15;
    }
    
    if (universityRow) {
      const tier = pick(universityRow, ['Priority Tier']);
      if (tier === 'A+') score += 20;
      else if (tier === 'A') score += 10;
    }

    if (/gdg|ieee|msp|أنشطة طلابية|مجتمعات/i.test(cSlug)) score += 10;

    if (score >= 80) return { label: 'توافق ممتاز (Strong Fit)', class: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
    if (score >= 60) return { label: 'توافق جيد (Good Fit)', class: 'bg-teal-500/20 text-teal-300 border-teal-500/30' };
    if (score >= 40) return { label: 'يحتاج اختبار (Needs Validation)', class: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
    return { label: 'توافق ضعيف (Weak Fit)', class: 'bg-rose-500/20 text-rose-300 border-rose-500/30' };
  }

  function scenarioCalculation(programRow, cohort, adBudget, instructorModelVal='percent_60', customHourlyRate=0, customHours=0) {
    const price = normalizeNum(pick(programRow,['السعر التخطيطي']));
    const min = normalizeNum(pick(programRow,['Min Cohort'])) || 10;
    const target = parseTargetRange(pick(programRow,['Target']), min);
    const max = normalizeNum(pick(programRow,['Max قبل Capacity Review'])) || target.high;
    const base = findFinancialBase(pick(programRow,['البرنامج / القاعدة']), cohort);
    const ops = base ? normalizeNum(pick(base,['Operations'])) : 1500;
    const revenue = price * cohort;
    
    // Config-driven payment fee percentage
    const paymentFeeRate = (dashboardConfig.paymentFeePct || 1) / 100;
    const paymentFees = revenue * paymentFeeRate;

    let instructor = 0;
    let instructorShareRate = 0;
    let isRevenueShare = false;

    if (!instructorModelVal || instructorModelVal === 'sheet') {
      instructor = base ? normalizeNum(pick(base,['Instructor Cost'])) : 0;
      if (revenue > 0) instructorShareRate = instructor / revenue;
    } else if (instructorModelVal.startsWith('percent_')) {
      const pctVal = Number(instructorModelVal.replace('percent_','')) || dashboardConfig.defaultInstructorSharePct;
      instructorShareRate = pctVal / 100;
      instructor = revenue * instructorShareRate;
      isRevenueShare = true;
    } else if (instructorModelVal.startsWith('hourly_')) {
      const rate = customHourlyRate > 0 ? customHourlyRate : (Number(instructorModelVal.replace('hourly_','')) || 250);
      const hours = customHours > 0 ? customHours : 30;
      instructor = rate * hours;
    } else if (instructorModelVal.startsWith('fixed_')) {
      instructor = Number(instructorModelVal.replace('fixed_','')) || 8000;
    }

    const yusrNet = revenue - instructor - ops - paymentFees - adBudget;
    const yusrPct = revenue > 0 ? (yusrNet / revenue) * 100 : 0;
    const instructorPct = revenue > 0 ? (instructor / revenue) * 100 : 0;
    const otherCosts = ops + paymentFees + adBudget;
    const otherCostsPct = revenue > 0 ? (otherCosts / revenue) * 100 : 0;

    // Spec §7: Break-even calculation
    // Revenue share has variable cost per student: Price * (instructorShareRate + paymentFeeRate)
    // Fixed cost = (Fixed Instructor Cost if fixed) + ops + adBudget
    let breakEven = NaN;
    if (price > 0) {
      const fixedCost = (isRevenueShare ? 0 : instructor) + ops + adBudget;
      const netRevPerStudent = price * (1 - (isRevenueShare ? instructorShareRate : 0) - paymentFeeRate);
      breakEven = netRevPerStudent > 0 ? Math.ceil(fixedCost / netRevPerStudent) : Infinity;
    }

    // Config-driven margin gate requirement
    const marginGateRequired = dashboardConfig.marginGatePct || 25;

    // Spec §8: Financial Gate Reason Strings
    const gateReasons = [];
    let gate = 'GREEN';

    if (cohort < min) {
      gate = 'RED';
      gateReasons.push(`عدد الطلاب (${cohort}) أقل من الحد الأدنى للدفعة (${min})`);
    }
    if (yusrNet < 0) {
      gate = 'RED';
      gateReasons.push(`صافي حصة يسر بالسالب (${money(yusrNet)})`);
    }
    if (yusrPct < marginGateRequired && yusrNet >= 0) {
      gate = 'RED';
      gateReasons.push(`نسبة هامش المساهمة (${pct(yusrPct)}) أقل من الحد المطلوب (${marginGateRequired}%)`);
    }
    if (cohort > max) {
      if (gate !== 'RED') gate = 'YELLOW';
      gateReasons.push(`عدد الطلاب (${cohort}) يتجاوز الحد الأقصى للسعة (${max}) — يحتاج مراجعة قدرة التشغيل والمدرب`);
    }
    if (gate === 'GREEN') {
      gateReasons.push(`السيناريو محقق للربحية المستهدفة (≥ ${marginGateRequired}%) وضمن حدود الدفعة المسموحة`);
    }

    return { price, min, target, max, instructor, instructorPct, ops, revenue, paymentFees, adBudget, otherCosts, otherCostsPct, yusrNet, yusrPct, contribution: yusrNet, margin: yusrPct, breakEven, gate, gateReasons, base };
  }

  function scenarioPage() {
    const programs = getScenarioPrograms();
    const universities = [...(state.data.universities || [])].sort((a,b)=>normalizeNum(pick(b,['Priority Score']))-normalizeNum(pick(a,['Priority Score'])));
    const partners = state.data.partners || [];
    const marketing = state.data.marketing || [];
    if (!programs.length) return '<div class="bg-white p-6 rounded-2xl text-xs text-slate-400 text-center">لا توجد برامج مالية قابلة للمحاكاة. راجع التحكم المالي.</div>';

    const first = programs[0];
    const min = normalizeNum(pick(first,['Min Cohort'])) || 10;
    const max = normalizeNum(pick(first,['Max قبل Capacity Review'])) || 30;
    const initCohort = Math.min(Math.max(parseTargetRange(pick(first,['Target']), min).low, min), max);
    setTimeout(() => initScenario(programs, universities, partners, marketing, initCohort), 0);

    return `
      ${pageIntro('المحاكي أداة قرار، مش زر إطلاق', 'اختار السيناريو وشوف الأثر المالي والسوق المستهدف. النتيجة لا تغيّر الشيت، ولا تعتبر إثبات طلب حقيقي.', [
        {label:'راجع فرص البرامج',page:'programs',icon:'◈'}, {label:'افتح الشيت للتعديل',href:CFG.sheetUrl,icon:'↗'}
      ])}

      ${actionGuide([
        ['اختار التراك ورقم الكوهورت','السعر والحد الأدنى والحد الأقصى بييجوا من التحكم المالي.'],
        ['حدد نظام أجر المدرب','اختار نسبة (مثل 60% للمدرب / 40% ليسر) أو بالساعة أو حسب الشيت.'],
        ['اقرأ حصة يسر وحصة المدرب','افصل بين صافي يسر ومبلغ المدرب والإيراد الكلي قبل الاتفاق الإداري.']
      ])}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-card space-y-4">
          <h3 class="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-3">ابني سيناريو راوند</h3>
          <div class="space-y-4 text-xs">
            <div>
              <label class="block font-bold text-slate-700 mb-1">البرنامج / التراك</label>
              <select id="scProgram" class="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-medium outline-none focus:border-brand-600">
                ${programs.map((p,i)=>`<option value="${i}">${esc(pick(p,['البرنامج / القاعدة']))}</option>`).join('')}
              </select>
            </div>

            <div>
              <div class="flex items-center justify-between font-bold text-slate-700 mb-1">
                <span>عدد الطلبة المتوقع</span>
                <b id="scCohortValue" class="text-brand-800 num">${initCohort} طالب</b>
              </div>
              <input id="scCohort" type="range" min="${min}" max="${max}" value="${initCohort}" step="1" class="my-2" />
              <div class="flex items-center justify-between text-[11px] text-slate-400">
                <span id="scMinLabel">الحد الأدنى ${min}</span>
                <span id="scMaxLabel">الحد الأقصى ${max}</span>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">نظام أجر المدرب (Instructor Model)</label>
              <select id="scInstructorModel" class="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-medium outline-none focus:border-brand-600">
                <optgroup label="نسبة من الإيراد (Revenue Share)">
                  <option value="percent_60" selected>نسبة 60% للمدرب (40% ليسر)</option>
                  <option value="percent_50">نسبة 50% للمدرب (50% ليسر)</option>
                  <option value="percent_70">نسبة 70% للمدرب (30% ليسر)</option>
                  <option value="percent_40">نسبة 40% للمدرب (60% ليسر)</option>
                </optgroup>
                <optgroup label="مبلغ ثابت (Fixed Cohort)">
                  <option value="sheet">مخطط الشيت التخطيطي (حسب الداتا المسجلة)</option>
                  <option value="fixed_5000">مبلغ ثابت 5,000 ج لكل الدفعة</option>
                  <option value="fixed_8000">مبلغ ثابت 8,000 ج لكل الدفعة</option>
                  <option value="fixed_10000">مبلغ ثابت 10,000 ج لكل الدفعة</option>
                  <option value="fixed_12000">مبلغ ثابت 12,000 ج لكل الدفعة</option>
                </optgroup>
                <optgroup label="بالساعة (Hourly Mode)">
                  <option value="hourly_200">بالساعة — pilot (30 ساعة × 200 ج = 6,000 ج)</option>
                  <option value="hourly_250">بالساعة — pilot (30 ساعة × 250 ج = 7,500 ج)</option>
                  <option value="hourly_350">بالساعة — pilot (30 ساعة × 350 ج = 10,500 ج)</option>
                  <option value="hourly_custom">معدل وساعات مخصصة (إدخال مؤقت متصفح)</option>
                </optgroup>
              </select>
            </div>

            <!-- Custom Hourly Inputs (Hidden by default, shown when hourly_custom selected) -->
            <div id="hourlyCustomInputs" class="hidden grid grid-cols-2 gap-3 p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl">
              <div>
                <label class="block font-bold text-amber-900 mb-1 text-[11px]">أجر الساعة (ج/ساعة) <span class="text-slate-400 font-normal">(مؤقت)</span></label>
                <input id="scCustomRate" type="number" value="250" step="10" min="50" class="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-bold" />
              </div>
              <div>
                <label class="block font-bold text-amber-900 mb-1 text-[11px]">عدد الساعات / الراوند <span class="text-slate-400 font-normal">(مؤقت)</span></label>
                <input id="scCustomHours" type="number" value="30" step="5" min="5" class="w-full bg-white border border-slate-200 p-2 rounded-lg text-xs font-bold" />
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">ميزانية الحملة</label>
              <select id="scAds" class="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-medium outline-none focus:border-brand-600">
                <option value="0">عضوي / شراكات — 0 ج</option>
                <option value="5000">اختبار صغير — 5,000 ج</option>
                <option value="10000">حملة متوسطة — 10,000 ج</option>
                <option value="20000">ضغط مرتفع — 20,000 ج</option>
              </select>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block font-bold text-slate-700 mb-1">الجامعة / السوق المستهدف</label>
                <select id="scUniversity" class="w-full bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none focus:border-brand-600">
                  <option value="">بدون جامعة محددة</option>
                  ${universities.map((u,i)=>`<option value="${i}">${esc(pick(u,['الجامعة / المؤسسة']))} — ${esc(pick(u,['Priority Tier']))}</option>`).join('')}
                </select>
              </div>

              <div>
                <label class="block font-bold text-slate-700 mb-1">الشريك / المجتمع الطلابي</label>
                <select id="scPartner" class="w-full bg-slate-50 border border-slate-200 p-2 rounded-xl font-medium outline-none focus:border-brand-600">
                  <option value="">اختياري — حسب الجامعة</option>
                  ${partners.map((p,i)=>`<option value="${i}">${esc(pick(p,['الجهة']))}</option>`).join('')}
                </select>
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">الجمهور المقترح</label>
              <div id="scAudience" class="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-600 font-medium leading-relaxed"></div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">قناة الوصول</label>
              <select id="scChannel" class="w-full bg-slate-50 border border-slate-200 p-2.5 rounded-xl font-medium outline-none focus:border-brand-600">
                <option>الأنشطة الطلابية / GDG / IEEE / MSP</option>
                <option>ورشة مجانية داخل الجامعة ← دفعة أونلاين</option>
                <option>ويبينار / عرض مباشر</option>
                <option>ريلز إنستجرام</option>
                <option>جروبات الجامعات على فيسبوك</option>
                <option>إعلانات ميتا</option>
                <option>إحالات واتساب</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Upgraded Scenario Result Card (Sections A - F) -->
        <div id="scenarioResultCard" class="bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 text-white p-6 rounded-2xl shadow-xl flex flex-col justify-between space-y-4">
          <div>
            <!-- Section A: Header & Key Metrics -->
            <div class="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <span class="text-xs font-bold text-slate-400 block">صافي حصة يسر المقترحة (Yusr Net)</span>
              <span id="scFitBadge" class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold border">—</span>
            </div>

            <div id="scContribution" class="text-3xl font-black text-emerald-400 my-1 num">—</div>
            <p class="text-[11px] text-slate-400">بعد خصم أجر المدرب + التشغيل + التسويق + رسوم الدفع (${dashboardConfig.paymentFeePct}%)</p>

            <div class="space-y-1.5 my-4">
              <span id="scFinancialStatus" class="inline-block px-3 py-1 rounded-full bg-white/10 text-white text-xs font-bold border border-white/15">الحالة المالية: —</span>
              <span id="scMarketStatus" class="inline-block px-3 py-1 rounded-full bg-white/10 text-white text-xs font-bold border border-white/15">إثبات الطلب: —</span>
            </div>

            <!-- Section B & C: Money Split Grid -->
            <div class="grid grid-cols-2 gap-2 my-4 text-xs">
              <div class="bg-emerald-500/10 p-3 rounded-xl border border-emerald-400/30 col-span-2 flex items-center justify-between">
                <div>
                  <span class="text-emerald-300 block text-[10px] font-bold">Section B: صافي حصة يسر (Yusr Net)</span>
                  <b id="scYusrNetShare" class="font-extrabold text-emerald-400 num text-base">—</b>
                </div>
                <span id="scYusrPctBadge" class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-extrabold text-xs num border border-emerald-500/30">—</span>
              </div>

              <div class="bg-teal-500/10 p-3 rounded-xl border border-teal-400/30 col-span-2 flex items-center justify-between">
                <div>
                  <span class="text-teal-300 block text-[10px] font-bold">Section B: أجر / حصة المدرب (Instructor)</span>
                  <b id="scInstructorShare" class="font-extrabold text-teal-300 num text-base">—</b>
                </div>
                <span id="scInstructorPctBadge" class="px-2.5 py-1 rounded-lg bg-teal-500/20 text-teal-300 font-extrabold text-xs num border border-teal-500/30">—</span>
              </div>

              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <span class="text-slate-400 block text-[10px]">إجمالي الإيراد</span>
                <b id="scRevenue" class="font-extrabold text-white num text-sm">—</b>
              </div>
              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <span class="text-slate-400 block text-[10px]">Section C: مصاريف (تشغيل+إعلان)</span>
                <b id="scOtherCosts" class="font-extrabold text-slate-300 num text-sm">—</b>
              </div>
              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <span class="text-slate-400 block text-[10px]">Section D: نقطة التعادل</span>
                <b id="scBreakEven" class="font-extrabold text-white num text-sm">—</b>
              </div>
              <div class="bg-white/5 p-2.5 rounded-xl border border-white/10">
                <span class="text-slate-400 block text-[10px]">Section D: الحكم المالي</span>
                <b id="scGate" class="font-extrabold text-amber-300 text-sm">—</b>
              </div>
            </div>

            <!-- Financial Gate Reason Section -->
            <div id="scGateReasons" class="p-3 bg-white/5 rounded-xl border border-white/10 text-[11px] space-y-1 mb-3"></div>

            <div class="h-1.5 w-full bg-white/10 rounded-full overflow-hidden my-3">
              <div id="scProgress" class="h-full bg-brand-400 transition-all duration-300" style="width:0%"></div>
            </div>

            <div id="scNotes" class="space-y-1 text-[11px] text-slate-300"></div>
          </div>

          <div class="space-y-2 pt-4 border-t border-white/10">
            <button id="copyScenarioBtn" class="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-brand-950 font-extrabold text-xs transition-colors shadow-lg shadow-brand-500/20">نسخ ملخص السيناريو</button>
            <div class="flex gap-2">
              <button data-quick-page="validation" class="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs">تحقق السوق</button>
              <button data-quick-page="finance" class="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs">الماليات</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function initScenario(programs, universities, partners) {
    const pEl = document.getElementById('scProgram'); if (!pEl) return;
    const cEl = document.getElementById('scCohort'), aEl = document.getElementById('scAds'), uEl = document.getElementById('scUniversity'), partnerEl = document.getElementById('scPartner'), imEl = document.getElementById('scInstructorModel');
    const customRateEl = document.getElementById('scCustomRate');
    const customHoursEl = document.getElementById('scCustomHours');
    const hourlyInputsDiv = document.getElementById('hourlyCustomInputs');
    let lastSummary = '';

    const update = () => {
      const p = programs[Number(pEl.value) || 0];
      const min = normalizeNum(pick(p,['Min Cohort'])) || 10;
      const max = normalizeNum(pick(p,['Max قبل Capacity Review'])) || parseTargetRange(pick(p,['Target']),min).high;
      if (cEl) {
        cEl.min = min; cEl.max = max;
        if (Number(cEl.value) < min) cEl.value = min;
        if (Number(cEl.value) > max) cEl.value = max;
      }
      const minLbl = document.getElementById('scMinLabel'); if (minLbl) minLbl.textContent = `الحد الأدنى ${min}`;
      const maxLbl = document.getElementById('scMaxLabel'); if (maxLbl) maxLbl.textContent = `الحد الأقصى ${max}`;
      const valLbl = document.getElementById('scCohortValue'); if (valLbl && cEl) valLbl.textContent = `${cEl.value} طالب`;
      
      const opp = mapProgramNameToOpportunity(pick(p,['البرنامج / القاعدة']));
      const audEl = document.getElementById('scAudience');
      if (audEl) audEl.textContent = opp ? localizeText(pick(opp,['الفئة'])) : 'راجع الجمهور في فرص البرامج أو حزمة الإطلاق.';

      // Toggle Custom Hourly Inputs
      const instModel = imEl ? imEl.value : 'percent_60';
      if (instModel === 'hourly_custom') {
        hourlyInputsDiv?.classList.remove('hidden');
      } else {
        hourlyInputsDiv?.classList.add('hidden');
      }

      const customRate = customRateEl ? Number(customRateEl.value) || 250 : 0;
      const customHours = customHoursEl ? Number(customHoursEl.value) || 30 : 0;
      const cohort = cEl ? Number(cEl.value) : min;
      const ads = aEl ? Number(aEl.value) : 0;

      const calc = scenarioCalculation(p, cohort, ads, instModel, customRate, customHours);

      const elContrib = document.getElementById('scContribution'); if (elContrib) elContrib.textContent = money(calc.yusrNet);
      const elYusrNet = document.getElementById('scYusrNetShare'); if (elYusrNet) elYusrNet.textContent = money(calc.yusrNet);
      const elYusrPct = document.getElementById('scYusrPctBadge'); if (elYusrPct) elYusrPct.textContent = pct(calc.yusrPct);
      const elInstShare = document.getElementById('scInstructorShare'); if (elInstShare) elInstShare.textContent = money(calc.instructor);
      const elInstPct = document.getElementById('scInstructorPctBadge'); if (elInstPct) elInstPct.textContent = pct(calc.instructorPct);
      const elRev = document.getElementById('scRevenue'); if (elRev) elRev.textContent = money(calc.revenue);
      const elOther = document.getElementById('scOtherCosts'); if (elOther) elOther.textContent = money(calc.otherCosts);
      const elBE = document.getElementById('scBreakEven'); if (elBE) elBE.textContent = Number.isFinite(calc.breakEven) && calc.breakEven !== Infinity ? `${calc.breakEven} طالب` : (calc.breakEven === Infinity ? 'خسارة لكل طالب' : '—');
      
      const gate = document.getElementById('scGate');
      if (gate) {
        gate.textContent = displayGate(calc.gate);
        gate.className = calc.gate === 'GREEN' ? 'text-emerald-400 font-bold' : calc.gate === 'RED' ? 'text-rose-400 font-bold' : 'text-amber-300 font-bold';
      }
      
      const finStatus = document.getElementById('scFinancialStatus');
      if (finStatus) finStatus.textContent = `الحالة المالية: ${displayGate(calc.gate)}`;

      const gateReasonsEl = document.getElementById('scGateReasons');
      if (gateReasonsEl) {
        gateReasonsEl.innerHTML = `<b class="block font-bold text-white mb-1">أسباب الحكم المالي:</b>` + 
          calc.gateReasons.map(r => `<div class="text-slate-300">• ${esc(r)}</div>`).join('');
      }
      
      const marketStatus = opp ? pick(opp,['Current Validation Status']) : 'لا توجد حالة تحقق';
      const mktStatusEl = document.getElementById('scMarketStatus');
      if (mktStatusEl) mktStatusEl.textContent = `إثبات الطلب: ${localizeText(marketStatus) || 'غير مثبت بعد'}`;
      
      const progEl = document.getElementById('scProgress');
      if (progEl) progEl.style.width = `${Math.max(0, Math.min(100, (cohort / Math.max(calc.target.high, 1)) * 100))}%`;
      
      const uni = uEl && uEl.value !== '' ? universities[Number(uEl.value)] : null;
      const partner = partnerEl && partnerEl.value !== '' ? partners[Number(partnerEl.value)] : null;
      const channel = document.getElementById('scChannel')?.value || '';

      const fit = calculateChannelFit(pick(p,['البرنامج / القاعدة']), uni, partner, channel);
      const fitBadge = document.getElementById('scFitBadge');
      if (fitBadge) {
        fitBadge.textContent = fit.label;
        fitBadge.className = `px-2.5 py-1 rounded-lg text-[10px] font-extrabold border ${fit.class}`;
      }
      
      const modelLabel = imEl ? imEl.options[imEl.selectedIndex].text : 'نسبة 60%';
      const notes = [
        `السعر التخطيطي: ${money(calc.price)} لكل طالب.`,
        `نظام الأجر: ${modelLabel}.`,
        `أجر/حصة المدرب: ${money(calc.instructor)} (${pct(calc.instructorPct)} من الإيراد).`,
        `صافي حصة يسر: ${money(calc.yusrNet)} (${pct(calc.yusrPct)} من الإيراد).`,
        `مصاريف تشغيل وإعلانات ورسوم: ${money(calc.otherCosts)}.`,
        `حدود الدفعة: حد أدنى ${calc.min}، هدف ${calc.target.low}${calc.target.high !== calc.target.low ? '–' + calc.target.high : ''}، حد أقصى ${calc.max}.`,
        opp ? `اختبار السوق المطلوب: ${pick(opp,['Min Qualified Leads']) || '—'} مهتم مؤهل / ${pick(opp,['Min Paid/Deposits']) || '—'} مدفوع أو عربون.` : '',
        uni ? `السوق: ${pick(uni,['الجامعة / المؤسسة'])} — أولوية ${pick(uni,['Priority Score']) || '—'}/100 — ${pick(uni,['Next Action'])}` : '',
        partner ? `الشريك: ${pick(partner,['الجهة'])} — الخطوة التالية: ${pick(partner,['Next Step'])}` : '',
        ads >= 10000 ? '⚠️ ميزانية الإعلان كبيرة؛ ما تعتبرها منطقية قبل إثبات التحويل المدفوع.' : 'ابدأ بأقل تكلفة وصول ممكنة، وبعد التنفيذ قارن CAC الفعلي بالتخطيط.'
      ].filter(Boolean).map(localizeText);

      const notesEl = document.getElementById('scNotes');
      if (notesEl) notesEl.innerHTML = notes.map(n => `<p class="leading-relaxed">• ${esc(n)}</p>`).join('');

      lastSummary = [
        `برنامج: ${localizeText(pick(p,['البرنامج / القاعدة']))}`,
        `عدد الطلبة: ${cohort}`,
        `نظام المدرب: ${modelLabel}`,
        `حصة المدرب: ${money(calc.instructor)} (${pct(calc.instructorPct)})`,
        `صافي حصة يسر: ${money(calc.yusrNet)} (${pct(calc.yusrPct)})`,
        `إجمالي الإيراد: ${money(calc.revenue)}`,
        `ميزانية الحملة: ${money(ads)}`,
        `نقطة التعادل: ${calc.breakEven} طالب`,
        `الحكم المالي: ${displayGate(calc.gate)}`,
        `توافق القناة: ${fit.label}`,
        `إثبات الطلب: ${localizeText(marketStatus)}`,
        uni ? `السوق: ${localizeText(pick(uni,['الجامعة / المؤسسة']))}` : '',
        partner ? `الشريك: ${localizeText(pick(partner,['الجهة']))}` : ''
      ].filter(Boolean).join('\n');
    };

    pEl.addEventListener('change', () => {
      if (cEl) cEl.value = parseTargetRange(pick(programs[Number(pEl.value)],['Target']), normalizeNum(pick(programs[Number(pEl.value)],['Min Cohort']))).low;
      update();
    });

    [cEl, aEl, uEl, partnerEl, imEl, customRateEl, customHoursEl, document.getElementById('scChannel')].forEach(el => {
      if (el) {
        el.addEventListener('input', update);
        el.addEventListener('change', update);
      }
    });

    document.getElementById('copyScenarioBtn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(lastSummary);
        toast('تم نسخ ملخص السيناريو');
      } catch (_) {
        toast('تعذر النسخ التلقائي');
      }
    });
    update();
  }

  /* Event Listeners Initialization */
  els.nav?.addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (btn) goto(btn.dataset.page);
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-quick-page]');
    if (btn) goto(btn.dataset.quickPage);
  });

  els.refresh?.addEventListener('click', () => refreshData(true));
  els.search?.addEventListener('input', e => globalSearch(e.target.value));

  document.addEventListener('click', e => {
    const r = e.target.closest('[data-search-page]');
    if (r) {
      goto(r.dataset.searchPage);
      document.querySelector('.search-results')?.remove();
      if (els.search) els.search.value = '';
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#globalSearch') && !e.target.closest('.search-results')) {
      document.querySelector('.search-results')?.remove();
    }
  });

  // Keyboard Shortcut listener for Global Search (Ctrl + K or /)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && document.activeElement !== els.search && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))) {
      e.preventDefault();
      els.search?.focus();
      els.search?.select();
    }
  });

  applySnapshot();
  buildSearchIndex();
  renderCurrent();
  renderHealthPanel();
  refreshData(false);
  setInterval(() => refreshData(false), CFG.refreshMs || 120000);
})();
