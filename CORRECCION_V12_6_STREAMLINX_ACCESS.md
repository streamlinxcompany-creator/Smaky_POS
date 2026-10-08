# v12.6 — acceso StreamLinx al POS Virgen

El botón POS Virgen usa el PIN de StreamLinx (7391) como credencial de su RPC, sin depender de la sesión normal del POS ni del usuario Gerente. La migración 0017 acepta tanto el PIN como el digest SHA-256 legado para compatibilidad con builds anteriores.
