// Intermediario de DLRS Vault para Gemini (Google Apps Script, gratis).
// La app le manda la foto de la carta; este programa se la pasa a Gemini con tu clave, que se guarda
// en "Propiedades de secuencia de comandos" (GEMINI_KEY) y nunca sale de tu cuenta de Google.

const MODELOS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

function doPost(e) {
  const peticion = JSON.parse(e.postData.contents);
  const clave = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!clave) return responder({ error: 'falta GEMINI_KEY' });
  const cuerpo = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: peticion.image } }, { text: peticion.prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  });
  for (const modelo of MODELOS) {
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
      method: 'post', contentType: 'application/json', payload: cuerpo,
      headers: { 'x-goog-api-key': clave }, muteHttpExceptions: true,
    });
    const codigo = r.getResponseCode();
    if (codigo === 200) return ContentService.createTextOutput(r.getContentText()).setMimeType(ContentService.MimeType.JSON);
    if (codigo === 429) return responder({ error: 'cuota' });
    // 503 (saturado) o 404 (modelo retirado): se prueba el siguiente
  }
  return responder({ error: 'no disponible' });
}

// Para comprobar que funciona abriendo la dirección en el navegador.
function doGet() {
  return responder({ ok: true, clave: !!PropertiesService.getScriptProperties().getProperty('GEMINI_KEY') });
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
