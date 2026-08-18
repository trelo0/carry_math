import AuthForm from '@/components/forms/AuthForm';

export const metadata = {
  title: 'Вход — District',
};

export default function LoginPage() {
  return (
    <div className="auth-page">
      <div className="container">
        <div className="auth-card signup-form">
          <h1 className="auth-title">Вход в платформу</h1>
          <AuthForm />
        </div>
      </div>
    </div>
  );
}
