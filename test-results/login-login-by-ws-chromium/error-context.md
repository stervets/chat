# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - generic:
      - img
    - generic [ref=e7]:
      - generic [ref=e8]: Авторизация
      - generic [ref=e9]:
        - button "Вход" [ref=e10] [cursor=pointer]:
          - generic [ref=e11]: Вход
        - button "Регистрация" [ref=e12] [cursor=pointer]:
          - generic [ref=e13]: Регистрация
      - generic [ref=e14]:
        - generic [ref=e15]: Username
        - textbox [ref=e16]
      - generic [ref=e17]:
        - generic [ref=e18]: Password
        - textbox [ref=e19]
      - button "Войти" [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: Войти
  - generic [ref=e22]:
    - button "Toggle Nuxt DevTools" [ref=e23] [cursor=pointer]:
      - img [ref=e24]
    - generic "Page load time" [ref=e27]:
      - generic [ref=e28]: "30"
      - generic [ref=e29]: ms
    - button "Toggle Component Inspector" [ref=e31] [cursor=pointer]:
      - img [ref=e32]
```