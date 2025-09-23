app.get("/api/take/countera", (req, res) => {
  const counterName = req.params.counters;
  const token = `A${String(tokenA).padStart(3, "0")}`;
  tokenA++;

  const queueData = {
    token: token,
    serviceTime: "00:00:01",
    counter: counterId,
  };
  runningQueue.push(queueData);

  broadcastQueue();
  printgenerator(token, counterId);
  res.json(queueData);
});

app.get("/api/take/counterb", (req, res) => {
  const counterId = "B";
  const token = `B${String(tokenB).padStart(3, "0")}`;
  tokenB++;

  const queueData = {
    token: token,
    serviceTime: "00:00:01",
    counter: counterId,
  };
  runningQueue.push(queueData);

  broadcastQueue();
  res.json(queueData);
});

app.get("/api/take/counterc", (req, res) => {
  const counterId = "C";
  const token = `C${String(tokenC).padStart(3, "0")}`;
  tokenC++;

  const queueData = {
    token: token,
    serviceTime: "00:00:01",
    counter: counterId,
  };
  runningQueue.push(queueData);

  broadcastQueue();
  res.json(queueData);
});

app.get("/api/take/counterd", (req, res) => {
  const counterId = "D";
  const token = `D${String(tokenD).padStart(3, "0")}`;
  tokenD++;

  const queueData = {
    token: token,
    serviceTime: "00:00:01",
    counter: counterId,
  };
  runningQueue.push(queueData);

  broadcastQueue();
  res.json(queueData);
});
