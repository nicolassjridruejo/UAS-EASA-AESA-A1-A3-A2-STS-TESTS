# Aula UAS — Android APK

Aplicación Android de Aula UAS (A1/A3, A2, STS y Radiofonista UAS).

## Descargar la aplicación

[**Descargar Aula UAS para Android (.apk)**](https://github.com/nicolassjridruejo/UAS-EASA-AESA-A1-A3-A2-STS-TESTS/raw/refs/heads/ChatGPT-Connector/Aula-UAS.apk)

Descarga el archivo en tu teléfono, ábrelo e instala la aplicación. Android puede pedir permiso para instalar aplicaciones desde el navegador o el gestor de archivos usado.

## Generar el APK desde GitHub

1. Comprueba que `index.source.xz.b64` está en la raíz del repositorio.
2. Abre **Actions**.
3. Selecciona **Build Aula UAS APK**.
4. Pulsa **Run workflow**.
5. Cuando termine, abre la ejecución y descarga el artefacto **Aula-UAS-APK**.
6. Dentro encontrarás `Aula-UAS-debug.apk`.

El workflow reconstruye `index.html`, incorpora los tres renders desde `app/src/main/assets/renders`, descarga los manuales oficiales de AESA y los incrusta antes de compilar para que el APK pueda funcionar sin conexión.

## Actualizaciones y progreso

La aplicación conserva el mismo identificador Android y la misma clave de progreso local. Antes de cambiar desde una APK antigua, entra en **Progreso → Exportar copia**. Si Android no permite instalar la nueva APK encima de la antigua, conserva ese JSON, desinstala la versión anterior, instala la nueva e importa la copia. Es una migración necesaria una sola vez cuando la versión antigua fue firmada con una clave temporal.

Las nuevas publicaciones deben firmarse siempre con la misma clave de distribución. El workflow solo reemplaza `Aula-UAS.apk` cuando están configurados los cuatro secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`. Si faltan, compila y verifica una APK de prueba como artefacto, pero conserva intacta la descarga pública anterior.
