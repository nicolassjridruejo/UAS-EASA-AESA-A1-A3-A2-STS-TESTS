# Aula UAS — Android APK

Aplicación Android de Aula UAS (A1/A3, A2, STS y Radiofonista UAS).

## Generar el APK desde GitHub

1. Comprueba que `index.source.xz.b64` está en la raíz del repositorio.
2. Abre **Actions**.
3. Selecciona **Build Aula UAS APK**.
4. Pulsa **Run workflow**.
5. Cuando termine, abre la ejecución y descarga el artefacto **Aula-UAS-APK**.
6. Dentro encontrarás `Aula-UAS-debug.apk`.

El workflow reconstruye `index.html`, incorpora los tres renders desde `app/src/main/assets/renders`, descarga los manuales oficiales de AESA y los incrusta antes de compilar para que el APK pueda funcionar sin conexión.
