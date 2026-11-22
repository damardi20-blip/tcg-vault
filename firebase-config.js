// Configuración de Firebase (proyecto "dlrs-vault", plan Spark gratuito) para guardar la colección en la
// nube y verla en varios dispositivos. Estos datos no son secretos: lo que protege cada colección son las
// reglas de Firestore (firestore.rules.txt): solo se puede leer o escribir conociendo su código TCG-XXXXXX.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDm8x2pDgQ_CIsrQBRvznL9Wfpy8_f2lNo",
  authDomain: "dlrs-vault.firebaseapp.com",
  projectId: "dlrs-vault",
  storageBucket: "dlrs-vault.firebasestorage.app",
  messagingSenderId: "645601304531",
  appId: "1:645601304531:web:5d334d82903992994f5926"
};
