import { createBrowserRouter } from "react-router-dom";
import { MAIN_PATH } from "src/constant";

import MainLayout from "src/layouts/MainLayout";

const router = createBrowserRouter([
  {
    path: MAIN_PATH.root,
    lazy: () => import("src/pages/LandingPage"),
  },
  {
    path: MAIN_PATH.login,
    lazy: async () => {
      const module = await import("src/pages/AuthPages");
      return { Component: module.LoginPage };
    },
  },
  {
    path: MAIN_PATH.signup,
    lazy: async () => {
      const module = await import("src/pages/AuthPages");
      return { Component: module.SignupPage };
    },
  },
  {
    path: MAIN_PATH.plans,
    lazy: async () => {
      const module = await import("src/pages/AuthPages");
      return { Component: module.PlansPage };
    },
  },
  {
    path: "/",
    element: <MainLayout />,
    children: [
      {
        path: MAIN_PATH.browse,
        lazy: () => import("src/pages/HomePage"),
      },
      {
        path: MAIN_PATH.genreExplore,
        children: [
          {
            path: ":genreId",
            lazy: () => import("src/pages/GenreExplore"),
          },
        ],
      },
      {
        path: MAIN_PATH.watch,
        lazy: () => import("src/pages/WatchPage"),
      },
    ],
  },
]);

export default router;
