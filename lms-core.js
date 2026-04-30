// lms-core.js — LearnSona LMS Engine (Final, Persona 3 Reload Sharp)
const firebaseConfig = {
  databaseURL: "https://web-lms-a0b07-default-rtdb.firebaseio.com/",
  projectId: "web-lms-a0b07"
};

let db = null;
let useFirebase = true;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} catch (e) {
  console.warn('Firebase tidak tersedia, pakai localStorage');
  useFirebase = false;
}

// ---------- AUTH ----------
let currentUser = null;
function loadUser() {
  const s = sessionStorage.getItem('lsu');
  if (s) try { currentUser = JSON.parse(s); } catch (e) { currentUser = null; }
}
function saveUser(u) { currentUser = u; sessionStorage.setItem('lsu', JSON.stringify(u)); }
function isLoggedIn() { return !!getCurrentUser(); }
function getCurrentUser() { return currentUser; }
function requireRole(...roles) {
  const u = getCurrentUser();
  if (!u) { window.location.href = 'login.html'; return false; }
  if (!roles.includes(u.role)) {
    window.location.href = u.role === 'dosen' ? 'dashboard-dosen.html' : 'dashboard-mahasiswa.html';
    return false;
  }
  return true;
}

// ---------- AI Risk Engine ----------
function calculateRisk(s) {
  const p = Number(s.progress) || 0;
  const l = Number(s.loginFrequency) || 0;
  const a = Number(s.assignmentScore) || 0;
  let status;
  if (p < 50 && l < 3 && a < 60) status = 'Kritis';
  else if (p < 70 || a < 70) status = 'Waspada';
  else status = 'Aman';
  const score = Math.round((100-p) + ((5-Math.min(l,5))*10) + (100-a));
  const indicators = [];
  if (p < 50) indicators.push({label:'Progress Rendah', detail:`Progress ${p}% (target 70%)`});
  if (l < 3) indicators.push({label:'Jarang Login', detail:`Login ${l}x/minggu (target 3x)`});
  if (a < 60) indicators.push({label:'Nilai Tugas Rendah', detail:`Nilai ${a} (target 70)`});
  if (p >= 50 && p < 70 && !indicators.find(i=>i.label.includes('Progress'))) indicators.push({label:'Progress Di Bawah Target', detail:`Progress ${p}% belum optimal`});
  if (a >= 60 && a < 70 && !indicators.find(i=>i.label.includes('Nilai'))) indicators.push({label:'Nilai Perlu Ditingkatkan', detail:`Nilai ${a} mendekati target`});
  if (indicators.length === 0) indicators.push({label:'Semua Indikator Baik', detail:'Mahasiswa memenuhi semua kriteria'});
  return { status, score, indicators };
}

// ---------- UTILITY ----------
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${type === 'success' ? '#00e676' : type === 'error' ? '#ff1744' : '#4d9fff'};
    color: #000; padding: 12px 20px; margin-bottom: 8px; font-weight: 500;
    clip-path: polygon(3% 0%, 100% 0%, 100% 80%, 97% 100%, 0% 100%, 0% 20%);
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ---------- DATA HELPERS ----------
async function getStudents() {
  if (useFirebase) {
    const snap = await db.ref('students').once('value');
    const data = snap.val();
    if (data) {
      return Object.values(data).map(s => {
        const r = calculateRisk(s);
        return {...s, riskStatus: r.status, riskScore: r.score, indicators: r.indicators};
      });
    }
    return [];
  } else {
    const saved = localStorage.getItem('ls_students');
    if (saved) {
      const arr = JSON.parse(saved); // array
      return arr.map(s => {
        const r = calculateRisk(s);
        return {...s, riskStatus: r.status, riskScore: r.score, indicators: r.indicators};
      });
    }
    return [];
  }
}

async function getStudentById(id) {
  const all = await getStudents();
  return all.find(s => s.id === id) || null;
}

async function saveStudent(student) {
  const risk = calculateRisk(student);
  const updated = {...student, riskStatus: risk.status, riskScore: risk.score, indicators: risk.indicators};
  if (useFirebase) {
    await db.ref('students/' + student.id).set(updated);
    if (updated.riskStatus === 'Kritis') {
      await sendNotification(student.id, `🚨 KRITIS: ${student.name} berisiko gagal! Progress ${student.progress}%, Nilai ${student.assignmentScore}.`);
    }
  } else {
    let students = JSON.parse(localStorage.getItem('ls_students') || '[]');
    const idx = students.findIndex(s => s.id === student.id);
    if (idx >= 0) students[idx] = updated;
    else students.push(updated);
    localStorage.setItem('ls_students', JSON.stringify(students));
  }
  return updated;
}

async function getClasses() {
  if (useFirebase) {
    const snap = await db.ref('classes').once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_classes') || '[]');
}

async function getClassById(id) {
  const classes = await getClasses();
  return classes.find(c => c.id === id) || null;
}

async function createClass(name, schedule, desc = '') {
  const newClass = {
    id: 'C' + Date.now(),
    name,
    schedule,
    description: desc,
    dosen: getCurrentUser()?.name || 'Dosen'
  };
  if (useFirebase) {
    await db.ref('classes/' + newClass.id).set(newClass);
  } else {
    const classes = JSON.parse(localStorage.getItem('ls_classes') || '[]');
    classes.push(newClass);
    localStorage.setItem('ls_classes', JSON.stringify(classes));
  }
  return newClass;
}

async function deleteClass(id) {
  if (useFirebase) {
    await db.ref('classes/' + id).remove();
  } else {
    let classes = JSON.parse(localStorage.getItem('ls_classes') || '[]');
    classes = classes.filter(c => c.id !== id);
    localStorage.setItem('ls_classes', JSON.stringify(classes));
  }
}

async function getMaterials() {
  if (useFirebase) {
    const snap = await db.ref('materials').once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_materials') || '[]');
}

async function addMaterial(mat) {
  const newMat = {
    id: 'M' + Date.now(),
    ...mat,
    uploadDate: new Date().toISOString().split('T')[0]
  };
  if (useFirebase) {
    const ref = db.ref('materials').push();
    newMat.id = ref.key;
    await ref.set(newMat);
  } else {
    const mats = JSON.parse(localStorage.getItem('ls_materials') || '[]');
    mats.push(newMat);
    localStorage.setItem('ls_materials', JSON.stringify(mats));
  }
  return newMat;
}

// ---------- ASSIGNMENTS ----------
async function getAssignments() {
  if (useFirebase) {
    const snap = await db.ref('assignments').once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_assignments') || '[]');
}

async function addAssignment(task) {
  const newTask = {
    id: 'T' + Date.now(),
    classId: task.classId,
    title: task.title,
    description: task.description || '',
    dueDate: task.dueDate,
    maxScore: Number(task.maxScore) || 100,
    createdAt: new Date().toISOString()
  };
  if (useFirebase) {
    const ref = db.ref('assignments').push();
    newTask.id = ref.key;
    await ref.set(newTask);
  } else {
    const tasks = JSON.parse(localStorage.getItem('ls_assignments') || '[]');
    tasks.push(newTask);
    localStorage.setItem('ls_assignments', JSON.stringify(tasks));
  }
  return newTask;
}

async function getAssignmentSubmissions(studentId) {
  if (useFirebase) {
    const snap = await db.ref('assignmentSubmissions').orderByChild('studentId').equalTo(studentId).once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_assignmentSubmissions') || '[]')
    .filter(s => s.studentId === studentId);
}

async function submitAssignment(studentId, assignmentId, answerUrl, note = '') {
  const submissions = await getAssignmentSubmissions(studentId);
  const existing = submissions.find(s => s.assignmentId === assignmentId);
  const rec = {
    id: existing?.id || 'S' + Date.now(),
    studentId,
    assignmentId,
    answerUrl,
    note,
    status: 'submitted',
    submittedAt: new Date().toISOString()
  };
  if (useFirebase) {
    if (existing?.id) {
      const snap = await db.ref('assignmentSubmissions').orderByChild('id').equalTo(existing.id).once('value');
      const key = snap.val() ? Object.keys(snap.val())[0] : null;
      if (key) await db.ref('assignmentSubmissions/' + key).set(rec);
      else await db.ref('assignmentSubmissions').push(rec);
    } else {
      await db.ref('assignmentSubmissions').push(rec);
    }
  } else {
    let all = JSON.parse(localStorage.getItem('ls_assignmentSubmissions') || '[]');
    const idx = all.findIndex(s => s.id === rec.id);
    if (idx >= 0) all[idx] = rec;
    else all.push(rec);
    localStorage.setItem('ls_assignmentSubmissions', JSON.stringify(all));
  }
  return rec;
}

async function enrollStudent(studentId, classId) {
  const student = await getStudentById(studentId);
  const cls = await getClassById(classId);
  if (student && cls) {
    student.class = cls.name;
    await saveStudent(student);
  }
  if (useFirebase) {
    await db.ref('enrollments/' + studentId).set(classId);
  } else {
    const enr = JSON.parse(localStorage.getItem('ls_enrollments') || '{}');
    enr[studentId] = classId;
    localStorage.setItem('ls_enrollments', JSON.stringify(enr));
  }
}

async function getEnrollments() {
  if (useFirebase) {
    const snap = await db.ref('enrollments').once('value');
    return snap.val() || {};
  }
  return JSON.parse(localStorage.getItem('ls_enrollments') || '{}');
}

// ---------- NOTIFICATIONS ----------
async function sendNotification(studentId, message) {
  const notif = {
    id: 'N' + Date.now(),
    student_id: studentId,
    message,
    status: 'unread',
    timestamp: new Date().toISOString()
  };
  if (useFirebase) {
    await db.ref('notifications').push(notif);
  } else {
    let notifs = JSON.parse(localStorage.getItem('ls_notifications') || '[]');
    notifs.unshift(notif);
    localStorage.setItem('ls_notifications', JSON.stringify(notifs));
  }
  return notif;
}

async function getNotifications() {
  if (useFirebase) {
    const snap = await db.ref('notifications').once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_notifications') || '[]');
}

// ---------- INTERVENTIONS ----------
async function saveIntervention(data) {
  const rec = {
    id: 'I' + Date.now(),
    student_id: data.student_id,
    action: data.action,
    notes: data.notes,
    date: new Date().toISOString().split('T')[0]
  };
  if (useFirebase) {
    await db.ref('interventions').push(rec);
  } else {
    let inter = JSON.parse(localStorage.getItem('ls_interventions') || '[]');
    inter.unshift(rec);
    localStorage.setItem('ls_interventions', JSON.stringify(inter));
  }
  return rec;
}

async function getInterventions() {
  if (useFirebase) {
    const snap = await db.ref('interventions').once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_interventions') || '[]');
}

// ---------- SETTINGS ----------
async function getSettings() {
  if (useFirebase) {
    const snap = await db.ref('settings/riskThreshold').once('value');
    const val = snap.val();
    return { riskThreshold: val || { aman: 70, waspada: 50, kritis: 30 } };
  }
  return JSON.parse(localStorage.getItem('ls_settings') || '{"riskThreshold":{"aman":70,"waspada":50,"kritis":30}}');
}

async function updateThreshold(t) {
  if (useFirebase) {
    await db.ref('settings/riskThreshold').set(t);
  } else {
    localStorage.setItem('ls_settings', JSON.stringify({ riskThreshold: t }));
  }
}

// ---------- QUIZ ----------
async function getQuizzes() {
  if (useFirebase) {
    const snap = await db.ref('quizzes').once('value');
    return snap.val() ? Object.values(snap.val()) : [];
  }
  return JSON.parse(localStorage.getItem('ls_quizzes') || '[]');
}

async function createQuiz(quiz) {
  const newQuiz = { id: 'Q' + Date.now(), ...quiz };
  if (useFirebase) {
    const ref = db.ref('quizzes').push();
    newQuiz.id = ref.key;
    await ref.set(newQuiz);
  } else {
    const qs = JSON.parse(localStorage.getItem('ls_quizzes') || '[]');
    qs.push(newQuiz);
    localStorage.setItem('ls_quizzes', JSON.stringify(qs));
  }
  return newQuiz;
}

async function deleteQuiz(id) {
  if (useFirebase) {
    await db.ref('quizzes/' + id).remove();
  } else {
    let qs = JSON.parse(localStorage.getItem('ls_quizzes') || '[]');
    qs = qs.filter(q => q.id !== id);
    localStorage.setItem('ls_quizzes', JSON.stringify(qs));
  }
}

async function getQuizById(id) {
  const quizzes = await getQuizzes();
  return quizzes.find(q => q.id === id) || null;
}

async function submitQuizAttempt(studentId, quizId, score) {
  const attempt = {
    id: 'A' + Date.now(),
    studentId,
    quizId,
    score,
    timestamp: new Date().toISOString()
  };
  if (useFirebase) {
    await db.ref('quizAttempts').push(attempt);
  } else {
    let atts = JSON.parse(localStorage.getItem('ls_quizAttempts') || '[]');
    atts.push(attempt);
    localStorage.setItem('ls_quizAttempts', JSON.stringify(atts));
  }
  // Update assignmentScore mahasiswa
  const student = await getStudentById(studentId);
  if (student) {
    const newScore = Math.round(score); // sederhana
    student.assignmentScore = newScore;
    await saveStudent(student);
  }
}

// ---------- LOGIN / REGISTER ----------
async function loginUser(email, password) {
  if (useFirebase) {
    const snap = await db.ref('users').orderByChild('email').equalTo(email).once('value');
    const users = snap.val();
    if (!users) return { success: false, error: 'Email tidak terdaftar' };
    const key = Object.keys(users)[0];
    const u = users[key];
    if (u.password !== password) return { success: false, error: 'Password salah' };
    const user = { uid: key, email, role: u.role, name: u.name, studentId: u.studentId || null };
    saveUser(user);
    return { success: true, user };
  } else {
    // Demo accounts
    const demoUsers = [
      { email: 'dosen@learnsona.ac.id', password: 'password123', role: 'dosen', name: 'Dosen Pembimbing', uid: 'd001' },
      { email: 'st001@learnsona.ac.id', password: 'password123', role: 'mahasiswa', name: 'Andi Pratama', studentId: 'STU001', uid: 's001' },
      { email: 'st002@learnsona.ac.id', password: 'password123', role: 'mahasiswa', name: 'Budi Santoso', studentId: 'STU002', uid: 's002' }
    ];
    const found = demoUsers.find(u => u.email === email && u.password === password);
    if (found) {
      const user = { uid: found.uid, email, role: found.role, name: found.name, studentId: found.studentId || null };
      saveUser(user);
      return { success: true, user };
    }
    return { success: false, error: 'Email atau password salah' };
  }
}

async function registerUser(email, password, name, role) {
  if (!useFirebase) return { success: false, error: 'Registrasi hanya tersedia dengan Firebase aktif' };
  try {
    const check = await db.ref('users').orderByChild('email').equalTo(email).once('value');
    if (check.exists()) return { success: false, error: 'Email sudah terdaftar' };
    const ref = db.ref('users').push();
    const uid = ref.key;
    const studentId = role === 'mahasiswa' ? 'STU' + Date.now().toString(36).toUpperCase() : null;
    await ref.set({ email, password, role, name, studentId });
    if (role === 'mahasiswa') {
      await db.ref('students/' + studentId).set({
        id: studentId,
        name,
        class: 'Belum Ditentukan',
        progress: 0,
        loginFrequency: 0,
        assignmentScore: 0,
        lastLogin: new Date().toISOString().split('T')[0]
      });
    }
    const user = { uid, email, role, name, studentId };
    saveUser(user);
    return { success: true, user };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function logoutUser() {
  sessionStorage.removeItem('lsu');
  window.location.href = 'login.html';
}

// ---------- SEED DATA ----------
async function seedData() {
  if (useFirebase) {
    const snap = await db.ref('students').once('value');
    if (!snap.exists()) {
      const students = {};
      const names = ['Andi Pratama','Budi Santoso','Citra Dewi','Dian Permata','Eko Prasetyo','Fani Rahmawati','Gilang Ramadhan','Hana Safira','Irfan Hakim','Jasmine Putri'];
      const progresses = [35,60,85,40,55,90,30,65,78,50];
      const logins = [2,4,5,1,3,5,2,4,4,2];
      const scores = [45,65,90,50,58,95,40,68,82,55];
      for (let i = 0; i < 10; i++) {
        const id = 'STU' + String(i+1).padStart(3,'0');
        students[id] = {
          id,
          name: names[i],
          class: 'TI-3' + String.fromCharCode(65 + (i % 3)),
          progress: progresses[i],
          loginFrequency: logins[i],
          assignmentScore: scores[i],
          lastLogin: '2026-04-2' + (i % 10)
        };
      }
      await db.ref('students').set(students);
      await db.ref('users').set({
        'dosen001': { email:'dosen@learnsona.ac.id', password:'password123', role:'dosen', name:'Dosen Pembimbing' },
        'stu001': { email:'st001@learnsona.ac.id', password:'password123', role:'mahasiswa', name:'Andi Pratama', studentId:'STU001' },
        'stu002': { email:'st002@learnsona.ac.id', password:'password123', role:'mahasiswa', name:'Budi Santoso', studentId:'STU002' }
      });
      await db.ref('settings/riskThreshold').set({ aman:70, waspada:50, kritis:30 });
    }
  } else {
    // localStorage default
    if (!localStorage.getItem('ls_students')) {
      const names = ['Andi Pratama','Budi Santoso','Citra Dewi','Dian Permata','Eko Prasetyo','Fani Rahmawati','Gilang Ramadhan','Hana Safira','Irfan Hakim','Jasmine Putri'];
      const progresses = [35,60,85,40,55,90,30,65,78,50];
      const logins = [2,4,5,1,3,5,2,4,4,2];
      const scores = [45,65,90,50,58,95,40,68,82,55];
      const arr = [];
      for (let i = 0; i < 10; i++) {
        arr.push({
          id: 'STU' + String(i+1).padStart(3,'0'),
          name: names[i],
          class: 'TI-3' + String.fromCharCode(65 + (i % 3)),
          progress: progresses[i],
          loginFrequency: logins[i],
          assignmentScore: scores[i],
          lastLogin: '2026-04-2' + (i % 10)
        });
      }
      localStorage.setItem('ls_students', JSON.stringify(arr));
      localStorage.setItem('ls_classes', JSON.stringify([]));
      localStorage.setItem('ls_materials', JSON.stringify([]));
      localStorage.setItem('ls_assignments', JSON.stringify([]));
      localStorage.setItem('ls_assignmentSubmissions', JSON.stringify([]));
      localStorage.setItem('ls_enrollments', JSON.stringify({}));
      localStorage.setItem('ls_notifications', JSON.stringify([]));
      localStorage.setItem('ls_interventions', JSON.stringify([]));
      localStorage.setItem('ls_quizzes', JSON.stringify([]));
      localStorage.setItem('ls_quizAttempts', JSON.stringify([]));
      localStorage.setItem('ls_settings', JSON.stringify({ riskThreshold: { aman:70, waspada:50, kritis:30 } }));
    }
  }
}

// ---------- INIT ----------
loadUser();
seedData();
