import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Chip,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DevicesIcon from "@mui/icons-material/Devices";
import MovieIcon from "@mui/icons-material/Movie";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SecurityIcon from "@mui/icons-material/Security";
import PwaInstallPrompt from "src/components/PwaInstallPrompt";

const heroPoster =
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1800&q=80";

export function Component() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#050505", color: "common.white" }}>
      <PwaInstallPrompt />
      <Box
        sx={{
          minHeight: "92vh",
          backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.66) 45%, rgba(0,0,0,0.2) 100%), linear-gradient(180deg, rgba(0,0,0,0.12), #050505 94%), url("${heroPoster}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <Container maxWidth="xl" sx={{ py: { xs: 2.5, md: 4 } }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: 0 }}>
              FLUX
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button
              component={RouterLink}
              to="/login"
              sx={{ color: "common.white", fontWeight: 900 }}
            >
              Entrar
            </Button>
            <Button
              component={RouterLink}
              to="/cadastro"
              variant="contained"
              sx={{
                bgcolor: "#e42c36",
                borderRadius: 1,
                fontWeight: 900,
                "&:hover": { bgcolor: "#f0444d" },
              }}
            >
              Começar
            </Button>
          </Stack>

          <Stack
            spacing={3}
            sx={{
              width: "min(780px, 100%)",
              pt: { xs: 12, md: 18 },
              pb: { xs: 8, md: 12 },
            }}
          >
            <Chip
              icon={<AutoAwesomeIcon />}
              label="Streaming organizado para sua casa"
              sx={{
                alignSelf: "flex-start",
                bgcolor: "rgba(255,255,255,0.12)",
                color: "common.white",
                fontWeight: 900,
              }}
            />
            <Typography
              variant="h1"
              sx={{
                fontWeight: 900,
                lineHeight: 0.95,
                letterSpacing: 0,
                fontSize: { xs: 44, md: 78 },
              }}
            >
              Filmes, séries, animes e canais em um só lugar.
            </Typography>
            <Typography
              variant="h5"
              sx={{ color: "grey.200", maxWidth: 680, lineHeight: 1.35 }}
            >
              O FLUX organiza listas IPTV em uma experiência moderna, com
              catálogo limpo, recomendações, favoritos e reprodução contínua.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <Button
                component={RouterLink}
                to="/cadastro"
                variant="contained"
                size="large"
                startIcon={<PlayArrowIcon />}
                sx={{
                  bgcolor: "common.white",
                  color: "#111",
                  borderRadius: 1,
                  fontWeight: 900,
                  px: 3,
                  "&:hover": { bgcolor: "#ddd" },
                }}
              >
                Criar conta
              </Button>
              <Button
                component={RouterLink}
                to="/planos"
                size="large"
                sx={{
                  bgcolor: "rgba(255,255,255,0.14)",
                  color: "common.white",
                  borderRadius: 1,
                  fontWeight: 900,
                  px: 3,
                  "&:hover": { bgcolor: "rgba(255,255,255,0.22)" },
                }}
              >
                Ver planos
              </Button>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: { xs: 5, md: 8 } }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            gap: 2,
          }}
        >
          {[
            {
              icon: <MovieIcon />,
              title: "Catálogo organizado",
              text: "Canais, filmes, séries e animes separados automaticamente.",
            },
            {
              icon: <DevicesIcon />,
              title: "Feito para TV e celular",
              text: "Interface limpa para Smart TV, desktop, Android e iPhone.",
            },
            {
              icon: <SecurityIcon />,
              title: "Conta e planos",
              text: "Fluxo visual de login, cadastro e assinatura pronto para evoluir.",
            },
          ].map((item) => (
            <Box
              key={item.title}
              sx={{
                p: 3,
                minHeight: 190,
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 1,
                bgcolor: "#111",
              }}
            >
              <Box sx={{ color: "#e42c36", mb: 2 }}>{item.icon}</Box>
              <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
                {item.title}
              </Typography>
              <Typography sx={{ color: "grey.400", lineHeight: 1.55 }}>
                {item.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}
