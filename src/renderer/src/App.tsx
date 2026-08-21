import electronLogo from './assets/electron.svg'

function App(): React.JSX.Element {
  return (
    <>
      <img alt="Maria POS" className="logo" src={electronLogo} />
      <div className="creator">Maria POS</div>
      <div className="text">Кассовое приложение готово к разработке</div>
      <p className="tip">Нажмите F12, чтобы открыть DevTools</p>
    </>
  )
}

export default App
