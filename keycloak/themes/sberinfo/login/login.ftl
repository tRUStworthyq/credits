<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SberInfo — Вход</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/login.css">
</head>
<body>
  <div class="auth-card">

    <div class="auth-logo">
      <h1>SberInfo</h1>
    </div>

    <div class="auth-tabs">
      <span class="auth-tab active">Вход</span>
      <#if realm.registrationAllowed>
        <a href="${url.registrationUrl}" class="auth-tab">Регистрация</a>
      </#if>
    </div>

    <#if message?has_content>
      <div class="auth-${message.type}">
        ${message.summary?no_esc}
      </div>
    </#if>

    <form class="auth-form" action="${url.loginAction}" method="post">

      <div class="form-group">
        <label for="username">Email</label>
        <input
          id="username"
          name="username"
          type="email"
          value="${(login.username!'')}"
          placeholder="example@mail.ru"
          autocomplete="email"
          autofocus
          required
          class="<#if messagesPerField.existsError('username')>has-error</#if>"
        >
        <#if messagesPerField.existsError('username')>
          <span class="field-error">${messagesPerField.get('username')}</span>
        </#if>
      </div>

      <div class="form-group">
        <label for="password">Пароль</label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autocomplete="current-password"
          required
          class="<#if messagesPerField.existsError('password')>has-error</#if>"
        >
        <#if messagesPerField.existsError('password')>
          <span class="field-error">${messagesPerField.get('password')}</span>
        </#if>
      </div>

      <input type="hidden" id="id-hidden-input" name="credentialId"
             <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>>

      <button type="submit" class="auth-submit">Войти</button>

    </form>

  </div>
</body>
</html>
