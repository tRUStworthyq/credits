<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SberInfo — Регистрация</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/login.css">
</head>
<body>
  <div class="auth-card">

    <div class="auth-logo">
      <h1>SberInfo</h1>
    </div>

    <div class="auth-tabs">
      <a href="${url.loginUrl}" class="auth-tab">Вход</a>
      <span class="auth-tab active">Регистрация</span>
    </div>

    <#if message?has_content && message.type == 'error'>
      <div class="auth-error">
        ${message.summary?no_esc}
      </div>
    </#if>

    <form class="auth-form" action="${url.registrationAction}" method="post">

      <div class="form-group">
        <label for="firstName">Имя</label>
        <input
          id="firstName"
          name="firstName"
          type="text"
          value="${(register.firstName!'')}"
          placeholder="Иван"
          autocomplete="given-name"
          required
          class="<#if messagesPerField.existsError('firstName')>has-error</#if>"
        >
        <#if messagesPerField.existsError('firstName')>
          <span class="field-error">${messagesPerField.get('firstName')}</span>
        </#if>
      </div>

      <div class="form-group">
        <label for="lastName">Фамилия</label>
        <input
          id="lastName"
          name="lastName"
          type="text"
          value="${(register.lastName!'')}"
          placeholder="Иванов"
          autocomplete="family-name"
          required
          class="<#if messagesPerField.existsError('lastName')>has-error</#if>"
        >
        <#if messagesPerField.existsError('lastName')>
          <span class="field-error">${messagesPerField.get('lastName')}</span>
        </#if>
      </div>

      <div class="form-group">
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          value="${(register.email!'')}"
          placeholder="example@mail.ru"
          autocomplete="email"
          required
          class="<#if messagesPerField.existsError('email')>has-error</#if>"
        >
        <#if messagesPerField.existsError('email')>
          <span class="field-error">${messagesPerField.get('email')}</span>
        </#if>
      </div>

      <div class="form-group">
        <label for="phone">Телефон</label>
        <input
          id="phone"
          name="user.attributes.phone"
          type="tel"
          value="${(register.formData['user.attributes.phone'])!''}"
          placeholder="+7 (999) 123-45-67"
          autocomplete="tel"
        >
      </div>

      <div class="form-group">
        <label for="password">Пароль</label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autocomplete="new-password"
          required
          class="<#if messagesPerField.existsError('password','password-confirm')>has-error</#if>"
        >
        <#if messagesPerField.existsError('password')>
          <span class="field-error">${messagesPerField.get('password')}</span>
        </#if>
      </div>

      <div class="form-group">
        <label for="password-confirm">Подтвердите пароль</label>
        <input
          id="password-confirm"
          name="password-confirm"
          type="password"
          placeholder="••••••••"
          autocomplete="new-password"
          required
          class="<#if messagesPerField.existsError('password-confirm')>has-error</#if>"
        >
        <#if messagesPerField.existsError('password-confirm')>
          <span class="field-error">${messagesPerField.get('password-confirm')}</span>
        </#if>
      </div>

      <button type="submit" class="auth-submit">Зарегистрироваться</button>

    </form>

  </div>
</body>
</html>
