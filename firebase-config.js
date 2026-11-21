// Configuración de Firebase para sincronizar tu colección entre dispositivos (opcional).
//
// 1. Ve a https://console.firebase.google.com y crea un proyecto gratuito (p. ej. "tcg-vault").
// 2. "Compilación" > "Firestore Database" > "Crear base de datos" (modo producción).
// 3. En "Reglas" de Firestore pega el contenido de firestore.rules.txt y pulsa Publicar.
// 4. Engranaje > "Configuración del proyecto" > "Tus apps" > icono web (</>).
//    Copia el objeto firebaseConfig y pégalo aquí abajo.
//
// Mientras apiKey siga en "TU_API_KEY", la app guarda las cartas solo en este dispositivo.

window.FIREBASE_CONFIG = {
  apiKey: "TU_API_KEY",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
