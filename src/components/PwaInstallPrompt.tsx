import { useEffect, useMemo, useState } from "react";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InstallMobileIcon from "@mui/icons-material/InstallMobile";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone
  );
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    window.localStorage.getItem("flux-pwa-dismissed") === "1"
  );
  const isIos = useMemo(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(userAgent);
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  if (dismissed || isStandalone() || (!installEvent && !isIos)) {
    return null;
  }

  const dismiss = () => {
    window.localStorage.setItem("flux-pwa-dismissed", "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!installEvent) {
      return;
    }

    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
    dismiss();
  };

  return (
    <Box
      sx={{
        position: "fixed",
        left: { xs: 12, md: 24 },
        right: { xs: 12, md: "auto" },
        bottom: { xs: 72, md: 24 },
        zIndex: 50,
        width: { xs: "auto", md: 380 },
        p: 1.5,
        borderRadius: 1,
        bgcolor: "rgba(12,12,12,0.94)",
        color: "common.white",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 18px 44px rgba(0,0,0,0.45)",
        backdropFilter: "blur(14px)",
      }}
    >
      <Stack direction="row" spacing={1.2} alignItems="flex-start">
        <InstallMobileIcon sx={{ color: "#e42c36", mt: 0.25 }} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 900 }}>
            Instale o FLUX no seu dispositivo
          </Typography>
          <Typography variant="body2" sx={{ color: "grey.300", mt: 0.4 }}>
            {isIos
              ? "No iPhone, abra pelo Safari, toque em Compartilhar e escolha Adicionar à Tela de Início."
              : "Toque em instalar para abrir o FLUX como aplicativo."}
          </Typography>
          {!isIos && (
            <Button
              onClick={install}
              size="small"
              variant="contained"
              sx={{
                mt: 1,
                bgcolor: "common.white",
                color: "#111",
                borderRadius: 1,
                fontWeight: 900,
                "&:hover": { bgcolor: "#ddd" },
              }}
            >
              Instalar
            </Button>
          )}
        </Box>
        <IconButton size="small" onClick={dismiss} sx={{ color: "grey.300" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
}
