import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { type LoginResponse, login } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@renderer/common/components/ui/tooltip';
import { queryKeys } from '@renderer/common/constants';
import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';

import { AuthShell } from '../components/auth-shell';
import { useAuthStore } from '../stores/auth-store';
import { type LoginValues, loginSchema } from './login.schema';

type LoginErrors = Partial<Record<keyof LoginValues, string>>;
type TouchedFields = Partial<Record<keyof LoginValues, boolean>>;

const getValidationErrors = (values: LoginValues): LoginErrors => {
  const result = loginSchema.safeParse(values);
  if (result.success) return {};

  return result.error.issues.reduce<LoginErrors>((errors, issue) => {
    const field = issue.path[0];
    if ((field === 'login' || field === 'password') && !errors[field]) {
      errors[field] = issue.message;
    }
    return errors;
  }, {});
};

export function LoginView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const [values, setValues] = useState<LoginValues>({
    login: '',
    password: '',
  });
  const [errors, setErrors] = useState<LoginErrors>({});
  const [touched, setTouched] = useState<TouchedFields>({});
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const mutation = useMutation({
    mutationFn: login,
    onError: (error) => httpErrorHandler(error),
    onSuccess: (result: LoginResponse) => {
      setAccessToken(result.auth.access_token);
      queryClient.setQueryData(queryKeys.auth.currentUser(), result.user);
      queryClient.setQueryData(
        queryKeys.organizations.mine(),
        result.organizations,
      );
      void navigate({ replace: true, to: '/select-organization' });
    },
  });

  const updateValue = (field: keyof LoginValues, value: string): void => {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    if (touched[field]) {
      setErrors((current) => ({
        ...current,
        [field]: getValidationErrors(nextValues)[field],
      }));
    }
  };

  const touchField = (field: keyof LoginValues): void => {
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({
      ...current,
      [field]: getValidationErrors(values)[field],
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (mutation.isPending) return;

    const validationErrors = getValidationErrors(values);
    setTouched({ login: true, password: true });
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const parsed = loginSchema.parse(values);
    mutation.mutate(parsed);
  };

  const passwordToggleLabel = isPasswordVisible
    ? 'Скрыть пароль'
    : 'Показать пароль';

  return (
    <AuthShell
      description="Введите данные своей учётной записи"
      title="Вход в DukenAI POS"
    >
      <form className="space-y-5" noValidate onSubmit={handleSubmit}>
        <FormField>
          <Label htmlFor="login">Email или телефон</Label>
          <Input
            aria-describedby={errors.login ? 'login-message' : undefined}
            aria-invalid={Boolean(errors.login)}
            autoComplete="username"
            id="login"
            name="login"
            onBlur={() => touchField('login')}
            onChange={(event) => updateValue('login', event.target.value)}
            placeholder="name@company.kz или +7 777 000 00 00"
            type="text"
            value={values.login}
          />
          {errors.login ? (
            <p
              aria-live="polite"
              className="px-1 text-xs text-destructive"
              id="login-message"
            >
              {errors.login}
            </p>
          ) : null}
        </FormField>

        <FormField>
          <Label htmlFor="password">Пароль</Label>
          <div className="relative">
            <Input
              aria-describedby={
                errors.password ? 'password-message' : undefined
              }
              aria-invalid={Boolean(errors.password)}
              autoComplete="current-password"
              className="pr-14"
              id="password"
              name="password"
              onBlur={() => touchField('password')}
              onChange={(event) => updateValue('password', event.target.value)}
              placeholder="••••••••"
              type={isPasswordVisible ? 'text' : 'password'}
              value={values.password}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={passwordToggleLabel}
                  className="absolute inset-y-0 right-1 my-auto active:translate-y-0"
                  onClick={() => setIsPasswordVisible((current) => !current)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  {isPasswordVisible ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{passwordToggleLabel}</TooltipContent>
            </Tooltip>
          </div>
          {errors.password ? (
            <p
              aria-live="polite"
              className="px-1 text-xs text-destructive"
              id="password-message"
            >
              {errors.password}
            </p>
          ) : null}
        </FormField>

        <Button
          className="mt-2 w-full rounded-lg font-semibold"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Войти
        </Button>
      </form>
    </AuthShell>
  );
}
