# طلب ميزة: المزامنة بين العائلات (Cross-Family Sync)

## الحالة: ⏳ قيد المراجعة — لم تبدأ بعد
**التاريخ:** 2026-11-16  
**الإصدار المستهدف:** v1.1.0 (Phase 5)  
**الأولوية:** عالية  
**المُعدّ:** Hermes Agent (تحليل معماري مُتحقَّق منه)

---

## 1. ملخص تنفيذي

بعد فحص الكود المصدري وقواعد أمان Firebase وقاعدة بيانات الإنتاج، تبيّن أن **"كل نسخة تعمل لوحدها"** ليس خطأً عشوائياً بل نتيجة **فجوة معمارية مقصودة**:

- **بوابة العائلات (`public/index.html`) تعمل بمصادقة محلية بحتة** عبر `handleFamilyLogin` (`app.js:1092-1166`). فهي لا تستدعي `loginFamilyMember` من `auth-v3.js` إطلاقاً (المستورد في `app.js:57-62` هو فقط `loginStaffWithGoogle / loginStaffWithEmail / signOutActiveUser`).
- **`switchFamilyRoom` (`app.js:238`) يضبط `state.roomId` محلياً فقط، ولا يبدأ محرك المزامنة `SyncEngine` أبداً.**
- **محرك المزامنة `SyncEngine` (`sync.js`) يستخدم مصادقة مجهولة فقط** (`signInAnonymouslyIfConfigured`، `sync.js:337`) ويكتب إلى مسار `v2/rooms/{roomId}/...` — وهو مسار **منفصل تماماً** عن بيانات التسجيل التي يكتبها `registerFamilyRequest` إلى `v3/...`.
- **النتيجة:** البيانات المسجلة عبر بوابة العائلات (`v3/familyIndex`, `v3/loginIndex`, `v3/users`) **لا تصل أبداً** إلى طبقة المزامنة (`v2/rooms`)، ولا تظهر على أي جهاز آخر.

---

## 2. الدليل المُتحقَّق منه (Evidence)

### 2.1 فصل مسارات البيانات

| الطبقة | المسار | من يكتب | من يقرأ |
|--------|-------|---------|---------|
| **التسجيل/الفهرس** | `/v3/familyIndex`, `/v3/loginIndex`, `/v3/users`, `/v3/families` | `registerFamilyRequest` (`auth-v3.js:340-348`) | `loginFamilyMember` (`auth-v3.js:117-168`) — **غير مستدعى** |
| **المزامنة الحية** | `/v2/rooms/{roomId}/items|cats|members|...` | `SyncEngine._doFlushOutbox` (`sync.js:236-246`) | `SyncEngine.start` (`sync.js:348-383`) |

**الفجوة:** لا يوجد أي كود يربط `v3/` بـ `v2/rooms/`. التسجيل يكتب في `v3/` فقط، والمزامنة تقرأ/تكتب في `v2/rooms/` فقط.

### 2.2 الدخول يعمل محلياً 100%

```js
// app.js:1092-1166 — handleFamilyLogin (الدخول الفعلي)
const famRoomId = resolveRoomInput(rawFam);       // يحول النص إلى roomId محلياً
await switchFamilyRoom(famRoomId);                // يضبط الغرفة محلياً فقط
// ...
state.session = { loggedIn: true, fid: state.roomId, ... };
// لا يوجد أي استدعاء لـ loginFamilyMember أو مصادقة Firebase للمستخدم
```

`resolveRoomInput` (`app.js:226-236`) يطابق الاسم النصي المُدخل يدوياً مع `state.prefs.familyNamesByRoom` (قاموس محلي) — **لا يقرأ من Firebase**.

### 2.3 switchFamilyRoom لا يبدأ المزامنة

```js
// app.js:238-250
async function switchFamilyRoom(newRoomId, displayName = '') {
  if (activeSyncEngine) { activeSyncEngine.stop(); activeSyncEngine = null; } // يوقف فقط
  state.roomId = clean;
  await registerFamilyCode(clean, displayName);
  await localStore.setPref('activeRoomId', clean);
  await refreshSnapshot();
  // لا يوجد: new SyncEngine(...) ولا activeSyncEngine.start()
}
```

المزامنة تبدأ **يدوياً فقط** عبر زر `#start-sync-btn` (`app.js:2611-2619`).

### 2.4 SyncEngine يكتب لمسار لا يطابق بيانات العائلة

```js
// sync.js:349 — collectionRef
const colRef = dbMod.ref(db, `v2/rooms/${this.roomId}/${col}`);
// this.roomId = 'family-v2-local' أو الاسم النصي المُدخل — ليس fid المسجل
```

وبما أن الدخول لا يضبط `state.roomId` من `fid` الحقيقي (المائل إلى `v3/familyIndex`)، فكل الأجهزة تكتب إلى **نفس** `v2/rooms/family-v2-local/` وتدهس بعضها.

### 2.5 قاعدة البيانات على الإنتاج

```bash
$ firebase database:get /v3 --project family-requests-9e431
null   # لا يوجد أي تسجيل عائلة عبر النموذج
$ firebase database:get /v3/familyIndex --project family-requests-9e431
null
```

**التفسير:** المستخدم جرّب "تسجيل عائلة جديدة" لكن بيانات التسجيل لم تُكتب فعلياً (لأن `registerFamilyRequest` قد يكون فشل بصمت — `auth-v3.js:349` يبتلع الخطأ في `console.error` فقط)، **أو** أن التطبيق الذي جرّبه على الجوال هو نسخة قديمة/مختلفة لا تحتوي على `registerFamilyRequest` المربوط.

---

## 3. السبب الجذري (Root Cause — مُؤكَّد)

| # | السبب | الدليل |
|---|-------|--------|
| **RC1** | بوابة العائلات تستخدم مصادقة محلية (`handleFamilyLogin`) بدل `loginFamilyMember` من `auth-v3.js` | `app.js:57-62` لا يستورد `loginFamilyMember` |
| **RC2** | `switchFamilyRoom` لا يبدأ `SyncEngine` | `app.js:238-250` لا يحتوي `new SyncEngine` |
| **RC3** | `roomId` لا يُشتق من `fid` المسجل | `state.roomId` يُضبط من النص المُدخل (`app.js:1101`), لا من `v3/familyIndex` |
| **RC4** | طبقتا البيانات `v3/` (تسجيل) و `v2/rooms/` (مزامنة) منفصلتان تماماً | لا يوجد كود يربطهما |

**الخلاصة:** هذه ليست مشكلة "مزامنة بين العائلات" فقط — بل **انقطاع كامل بين التسجيل والمزامنة**. أي جهازين يسجلان دخول بعائلتين مختلفتين سيعملان كجزيرتين منفصلتين إلى الأبد، لأن:
1. الدخول لا يتحقق من Firebase (يعمل محلياً).
2. المزامنة (إن بدأت يدوياً) تكتب إلى `v2/rooms/` بينما البيانات في `v3/`.

---

## 4. نطاق الميزة المطلوبة

### 4.1 الهدف الأساسي (الحل الجذري)
ربط طبقة التسجيل (`v3/`) بطبقة المزامنة (`v2/rooms/`) بحيث:
- **كل عائلة مسجلة = غرفة مزامنة مستقلة** (`roomId = fid`).
- **الدخول يتحقق من Firebase** عبر `loginFamilyMember` بدل المصادقة المحلية.
- **المزامنة تبدأ تلقائياً** بعد الدخول.
- **الأجهزة المختلفة ترى نفس بيانات العائلة.**

### 4.2 القدرات المطلوبة (بعد إصلاح RC1-RC4)

| القدرة | الوصف |
|--------|-------|
| **مزامنة داخل العائلة** | جهازان على نفس العائلة يريان نفس الطلبات/المهام/الميزانية لحظياً |
| **تسجيل عائلة حقيقي** | بيانات التسجيل (`v3/`) تظهر فعلياً لكل الأجهزة |
| **مزامنة تلقائية** | `SyncEngine` يبدأ تلقائياً بعد الدخول، ويتوقف عند الخروج |
| **مزامنة بين العائلات (اختياري — Phase 5b)** | مشاركة مساحات محددة بين عائلتين (قائمة مشتريات مشتركة، طلبات) مع تدقيق كامل |

---

## 5. المراحل المقترحة

### المرحلة 1: إصلاح الانقطاع (v1.1.0) — **إلزامي**
- [ ] استيراد `loginFamilyMember` و`registerFamilyRequest` في `app.js`.
- [ ] تعديل `handleFamilyLogin` لاستدعاء `loginFamilyMember({ familyName, memberName, password })` بدل المصادقة المحلية.
- [ ] تعديل `switchFamilyRoom` لتبدأ `SyncEngine` تلقائياً.
- [ ] تعديل `state.roomId` ليُضبط من `fid` العائد من Firebase (بعد تحقق `loginFamilyMember`).
- [ ] إصلاح `registerFamilyRequest` ليُبلّغ الأخطاء بدل ابتلاعها (`auth-v3.js:349`).
- [ ] اختبار: جهازان يسجلان دخول بنفس العائلة → يريان نفس البيانات.

### المرحلة 2: المزامنة بين العائلات (v1.2.0) — **اختياري**
- [ ] جدول `v3/sharedSpaces/{spaceId}` بقواعد أمان.
- [ ] واجهة "المساحات المشتركة" في الإعدادات.
- [ ] مشاركة قوائم/طلبات محددة بين عائلتين.
- [ ] إشعارات فورية عند تحديث من عائلة أخرى.

---

## 6. الأسئلة المفتوحة (تحتاج قرارك)

| # | السؤال | الخيارات |
|---|--------|----------|
| 1 | هل تريد إصلاح المرحلة 1 (ربط التسجيل بالمزامنة)؟ | **(أ) نعم — هذا هو الأساس ويجب إصلاحه أولاً** (موصى به)<br>(ب) لا — أريد المزامنة بين العائلات فقط كما هي |
| 2 | هل تقبل أن تُعدّل بوابة العائلات لتستخدم `loginFamilyMember` الحقيقي؟ | **(أ) نعم** (موصى به)<br>(ب) لا — أبقِ المصادقة المحلية |
| 3 | هل تريد إضافة ميزة "المساحات المشتركة" بين العائلات؟ | (أ) نعم — بعد إصلاح المرحلة 1<br>(ب) لا — يكفي إصلاح المزامنة داخل العائلة |

---

## 7. ملاحظة مهمة

بدون إصلاح المرحلة 1، **أي ميزة "مزامنة بين العائلات" لن تعمل**، لأن:
- لا توجد عائلة "حقيقية" في Firebase أصلاً (`/v3` فارغ).
- الأجهزة لا تعرف بعضها عبر Firebase.
- البيانات تعيش محلياً في IndexedDB فقط.

**الخطوة العملية التالية:** إصلاح RC1-RC4 أولاً (المرحلة 1)، ثم بناء ميزة المشاركة بين العائلات (المرحلة 2) فوق أساس سليم.

---

*تم إعداد هذا الطلب بواسطة: Hermes Agent*  
*للمشروع: Family OS (aliazizdbab/family-os)*  
*الفرع: main*  
*التاريخ: 2026-11-16*