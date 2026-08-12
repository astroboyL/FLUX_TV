import * as React from "react";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import ChildCareIcon from "@mui/icons-material/ChildCare";
import SearchIcon from "@mui/icons-material/Search";
import useOffSetTop from "src/hooks/useOffSetTop";
import { APP_BAR_HEIGHT } from "src/constant";

const MainHeader = () => {
  const isOffset = useOffSetTop(APP_BAR_HEIGHT);
  const [activeHash, setActiveHash] = React.useState(
    window.location.hash || "#canais"
  );

  React.useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || "#canais");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const navItems = [
    { label: "Canais", href: "#canais" },
    { label: "Filmes", href: "#filmes" },
    { label: "Séries", href: "#series" },
    { label: "Animes", href: "#animes" },
  ];

  return (
    <AppBar
      sx={{
        px: { xs: 2, md: "60px" },
        height: APP_BAR_HEIGHT,
        backgroundImage: "none",
        transition: "background-color 180ms ease, border-color 180ms ease",
        bgcolor: isOffset ? "rgba(0,0,0,0.98)" : "rgba(0,0,0,0.92)",
        borderBottom: isOffset
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid transparent",
        boxShadow: 0,
        backdropFilter: "blur(14px)",
      }}
    >
      <Toolbar disableGutters>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: 0,
              color: "common.white",
            }}
          >
            FLUX
          </Typography>
          <Stack
            direction="row"
            spacing={{ xs: 1.2, md: 3 }}
            sx={{ display: { xs: "none", sm: "flex" }, pl: { sm: 1, md: 3 } }}
          >
            {navItems.map((item) => {
              const selected = activeHash === item.href;

              return (
                <Typography
                  key={item.href}
                  component="a"
                  href={item.href}
                  variant="body2"
                  sx={{
                    color: selected ? "common.white" : "grey.300",
                    fontWeight: selected ? 900 : 700,
                    px: selected ? 1.7 : 0,
                    py: selected ? 1 : 0,
                    borderRadius: selected ? 8 : 0,
                    bgcolor:
                      selected ? "rgba(255,255,255,0.16)" : "transparent",
                    textDecoration: "none",
                    transition: "color 160ms ease, background-color 160ms ease",
                    "&:hover": { color: "common.white" },
                  }}
                >
                  {item.label}
                </Typography>
              );
            })}
          </Stack>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        <Stack direction="row" spacing={1.2} alignItems="center">
          <IconButton
            component="a"
            href="#catalog-search"
            aria-label="Buscar no catalogo"
            sx={{ color: "common.white" }}
          >
            <SearchIcon />
          </IconButton>
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{ color: "grey.200" }}
          >
            <ChildCareIcon fontSize="small" />
            <Typography
              variant="body2"
              sx={{ display: { xs: "none", sm: "block" }, fontWeight: 800 }}
            >
              Infantil
            </Typography>
          </Stack>
          <IconButton aria-label="Perfil" sx={{ color: "common.white" }}>
            <AccountCircleIcon />
          </IconButton>
        </Stack>
      </Toolbar>
    </AppBar>
  );
};

export default MainHeader;
