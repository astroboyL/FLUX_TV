import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  Box,
  Button,
  Chip,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import LockIcon from "@mui/icons-material/Lock";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

type PlanId = "filmes" | "combo" | "completo";

const PLANS: {
  id: PlanId;
  name: string;
  price: string;
  description: string;
  features: string[];
}[] = [
  {
    id: "filmes",
    name: "Filmes",
    price: "R$ 19,90",
    description: "Para quem quer uma locadora moderna dentro de casa.",
    features: ["Filmes VOD", "Favoritos", "Continuar assistindo"],
  },
  {
    id: "combo",
    name: "Filmes + Séries",
    price: "R$ 29,90",
    description: "Catálogo completo de filmes, séries e animes.",
    features: ["Filmes", "Séries e animes", "Catálogo organizado"],
  },
  {
    id: "completo",
    name: "Completo",
    price: "R$ 39,90",
    description: "Tudo liberado, incluindo canais ao vivo.",
    features: ["Canais ao vivo", "Filmes", "Séries", "Animes"],
  },
];

function saveDemoSession(plan: PlanId, email: string) {
  window.localStorage.setItem(
    "flux-session",
    JSON.stringify({
      email,
      plan,
      signedInAt: new Date().toISOString(),
    })
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#050505",
        color: "common.white",
        background:
          "radial-gradient(circle at 18% 12%, rgba(228,44,54,0.2), transparent 32%), linear-gradient(180deg, #111, #050505 58%)",
      }}
    >
      <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 6 }}>
          <Typography
            component={RouterLink}
            to="/"
            variant="h4"
            sx={{
              color: "common.white",
              textDecoration: "none",
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            FLUX
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button component={RouterLink} to="/login" sx={{ color: "grey.200", fontWeight: 900 }}>
            Entrar
          </Button>
        </Stack>
        {children}
      </Container>
    </Box>
  );
}

export function PlansPage() {
  return (
    <PageShell>
      <Stack spacing={2} sx={{ mb: 4, maxWidth: 680 }}>
        <Typography variant="h2" sx={{ fontWeight: 900, letterSpacing: 0 }}>
          Escolha seu plano
        </Typography>
        <Typography sx={{ color: "grey.300", fontSize: 18 }}>
          Planos visuais para o fluxo inicial. Pagamento e banco entram na próxima etapa.
        </Typography>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        {PLANS.map((plan) => (
          <Box
            key={plan.id}
            sx={{
              p: 3,
              minHeight: 380,
              display: "flex",
              flexDirection: "column",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 1,
              bgcolor: plan.id === "completo" ? "rgba(228,44,54,0.16)" : "#121212",
            }}
          >
            {plan.id === "completo" && (
              <Chip
                label="Mais escolhido"
                sx={{
                  alignSelf: "flex-start",
                  mb: 2,
                  bgcolor: "#e42c36",
                  color: "common.white",
                  fontWeight: 900,
                }}
              />
            )}
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              {plan.name}
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 900, mt: 2 }}>
              {plan.price}
            </Typography>
            <Typography sx={{ color: "grey.300", my: 2 }}>{plan.description}</Typography>
            <Stack spacing={1.2} sx={{ mb: 3 }}>
              {plan.features.map((feature) => (
                <Stack key={feature} direction="row" spacing={1} alignItems="center">
                  <CheckIcon fontSize="small" sx={{ color: "#46d369" }} />
                  <Typography>{feature}</Typography>
                </Stack>
              ))}
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Button
              component={RouterLink}
              to={`/cadastro?plano=${plan.id}`}
              variant="contained"
              sx={{
                bgcolor: "common.white",
                color: "#111",
                borderRadius: 1,
                fontWeight: 900,
                "&:hover": { bgcolor: "#ddd" },
              }}
            >
              Assinar plano
            </Button>
          </Box>
        ))}
      </Box>
    </PageShell>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialPlan = (params.get("plano") as PlanId) || "completo";
  const [plan, setPlan] = useState<PlanId>(initialPlan);
  const selectedPlan = useMemo(
    () => PLANS.find((currentPlan) => currentPlan.id === plan) || PLANS[2],
    [plan]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    saveDemoSession(plan, String(formData.get("email") || "cliente@flux.local"));
    navigate("/browse#filmes");
  };

  return (
    <PageShell>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 0.86fr" },
          gap: 4,
          alignItems: "start",
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h2" sx={{ fontWeight: 900, letterSpacing: 0 }}>
            Crie sua conta
          </Typography>
          <Typography sx={{ color: "grey.300", fontSize: 18 }}>
            Cadastre-se para acessar o catálogo FLUX. Nesta versão, o cadastro é visual e salva sua sessão no navegador.
          </Typography>
          <Box sx={{ p: 3, borderRadius: 1, bgcolor: "#121212", border: "1px solid rgba(255,255,255,0.1)" }}>
            <Typography variant="h5" sx={{ fontWeight: 900 }}>
              Plano selecionado: {selectedPlan.name}
            </Typography>
            <Typography sx={{ color: "grey.300", mt: 0.5 }}>
              {selectedPlan.price}/mês
            </Typography>
          </Box>
        </Stack>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            p: 3,
            borderRadius: 1,
            bgcolor: "#121212",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <Stack spacing={2}>
            <TextField name="name" label="Nome" required fullWidth />
            <TextField name="email" label="E-mail" type="email" required fullWidth />
            <TextField name="password" label="Senha" type="password" required fullWidth />
            <TextField
              select
              label="Plano"
              value={plan}
              onChange={(event) => setPlan(event.target.value as PlanId)}
              fullWidth
            >
              {PLANS.map((currentPlan) => (
                <MenuItem key={currentPlan.id} value={currentPlan.id}>
                  {currentPlan.name} - {currentPlan.price}
                </MenuItem>
              ))}
            </TextField>
            <Button
              type="submit"
              variant="contained"
              size="large"
              startIcon={<PlayArrowIcon />}
              sx={{
                bgcolor: "#e42c36",
                borderRadius: 1,
                fontWeight: 900,
                "&:hover": { bgcolor: "#f0444d" },
              }}
            >
              Criar conta e entrar
            </Button>
          </Stack>
        </Box>
      </Box>
    </PageShell>
  );
}

export function LoginPage() {
  const navigate = useNavigate();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    saveDemoSession("completo", String(formData.get("email") || "cliente@flux.local"));
    navigate("/browse#canais");
  };

  return (
    <PageShell>
      <Box sx={{ width: "min(460px, 100%)", mx: "auto" }}>
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            p: 3,
            borderRadius: 1,
            bgcolor: "#121212",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <Stack spacing={2}>
            <LockIcon sx={{ color: "#e42c36" }} />
            <Typography variant="h3" sx={{ fontWeight: 900 }}>
              Entrar
            </Typography>
            <TextField name="email" label="E-mail" type="email" required fullWidth />
            <TextField name="password" label="Senha" type="password" required fullWidth />
            <Button
              type="submit"
              variant="contained"
              size="large"
              sx={{
                bgcolor: "#e42c36",
                borderRadius: 1,
                fontWeight: 900,
                "&:hover": { bgcolor: "#f0444d" },
              }}
            >
              Acessar FLUX
            </Button>
            <Button component={RouterLink} to="/cadastro" sx={{ color: "grey.200" }}>
              Criar uma conta
            </Button>
          </Stack>
        </Box>
      </Box>
    </PageShell>
  );
}
