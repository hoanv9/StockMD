$(document).ready(function () {
    // --- State Management ---
    let currentMode = $('#marketView').length > 0 ? 'market' : 'stock';
    let allSymbols = [];
    let availableDates = [];
    // Load visibility from localStorage or default
    let stockChartVisibility = JSON.parse(localStorage.getItem('stockChartVisibility')) || {
        'Match Volume': false, // false means NOT hidden (visible)
        'Total Stock Vol': false
    };
    let marketChartVisibility = JSON.parse(localStorage.getItem('marketChartVisibility')) || {
        'Match Volume': false,
        'Total Stock Volume': false,
        'Stock Volume': false
    };
    let stockChartType = localStorage.getItem('stockChartType') || 'bar';
    let marketChartType = localStorage.getItem('marketChartType') || 'bar';
    let currentStockData = [];
    let currentMarketData = [];
    let topStocksChart, exchangePieChart, stockHistoryChart, totalMatchVolChart, totalStockVolChart;
    let marketTable, stockHistoryTable;

    // --- Initialization ---

    // Load last update timestamp
    function loadLastUpdate() {
        $.get('/api/last-update', function (res) {
            if (res.last_update) {
                $('#lastUpdateValue').text('Last update: ' + res.last_update);
            } else {
                $('#lastUpdateValue').text('No data yet');
            }
        }).fail(function () {
            $('#lastUpdateValue').text('–');
        });
    }
    loadLastUpdate();

    // Load Symbols for Floating Search
    $.get('/api/symbols', function (data) {
        allSymbols = data;
        if (currentMode === 'stock') {
            const symbol = $('#currentSymbol').val();
            const stockInfo = allSymbols.find(s => s.symbol === symbol);
            if (stockInfo) {
                $('#stockCompanyName').text(stockInfo.company_name);
            }
        }
    });

    // Initialize Flatpickr and Load Data
    $.get('/api/available-dates', function (dates) {
        availableDates = dates || [];
        // Get dates from URL params if available
        const urlParams = new URLSearchParams(window.location.search);
        const urlFromDate = urlParams.get('from_date');
        const urlToDate = urlParams.get('to_date');

        if (dates && dates.length > 0) {
            const latestDate = dates[0];
            const config = {
                dateFormat: "Y-m-d",
                enable: dates,
                defaultDate: latestDate
            };

            // Override default if URL params exist
            const fromConfig = { ...config, defaultDate: urlFromDate || latestDate };
            const toConfig = { ...config, defaultDate: urlToDate || latestDate };

            $('#fromDate').flatpickr(fromConfig);
            $('#toDate').flatpickr(toConfig);
            loadData();
        } else {
            const today = new Date().toISOString().split('T')[0];
            $('#fromDate').flatpickr({ dateFormat: "Y-m-d", defaultDate: urlFromDate || today });
            $('#toDate').flatpickr({ dateFormat: "Y-m-d", defaultDate: urlToDate || today });
            loadData();
        }
    });

    // Initialize DataTables based on mode
    if (currentMode === 'market') {
        marketTable = $('#marketTable').DataTable({
            order: [[2, 'desc']], // Sort by Match Vol
            columns: [
                { data: 'stock_symbol', render: (data) => `<span class="fw-bold text-primary pointer-cursor">${data}</span>` },
                { data: 'exchange', render: (data) => data.toUpperCase() },
                { data: 'match_vol', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) },
                { data: 'stock_vol', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) },
                { data: 'match_val', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) },
                { data: 'ratio', className: 'text-end', render: (data) => `${data.toFixed(2)}%` }
            ]
        });

        // Add click event for Market Table rows
        $('#marketTable tbody').on('click', 'tr', function () {
            const data = marketTable.row(this).data();
            if (data && data.stock_symbol) {
                const fromDate = $('#fromDate').val();
                const toDate = $('#toDate').val();
                window.location.href = `/stock/${data.stock_symbol}?from_date=${fromDate}&to_date=${toDate}`;
            }
        });
    } else {
        stockHistoryTable = $('#stockHistoryTable').DataTable({
            order: [[0, 'desc']],
            columns: [
                { data: 'date' },
                { data: 'match_vol', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) },
                { data: 'stock_vol', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) },
                { data: 'match_val', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) },
                { data: 'ratio', className: 'text-end', render: (data) => `${data.toFixed(2)}%` },
                { data: 'implied_price', className: 'text-end', render: $.fn.dataTable.render.number(',', '.', 0) }
            ]
        });
    }

    // --- Floating Search Logic ---
    $(document).keydown(function (e) {
        if ($(e.target).is('input, select, textarea')) return;

        if (/^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
            $('#floatingSearchOverlay').fadeIn(200);
            $('#floatingSearchBox').fadeIn(200);
            $('#floatingInput').val('').focus().val(e.key);
            filterFloatingResults(e.key);
            e.preventDefault();
        }
    });

    $('#floatingSearchOverlay').click(closeFloatingSearch);
    $(document).keydown(function (e) {
        if (e.key === 'Escape') closeFloatingSearch();
    });

    function closeFloatingSearch() {
        $('#floatingSearchOverlay').fadeOut(200);
        $('#floatingSearchBox').fadeOut(200);
        $('#floatingInput').val('');
    }

    $('#floatingInput').on('input', function () {
        filterFloatingResults($(this).val());
    });

    function filterFloatingResults(query) {
        const resultsDiv = $('#floatingSearchResults');
        resultsDiv.empty();

        if (!query) return;

        const filtered = allSymbols.filter(s => {
            if (!s || !s.symbol) return false;
            return s.symbol.toUpperCase().includes(query.toUpperCase()) ||
                (s.company_name && s.company_name.toUpperCase().includes(query.toUpperCase())) ||
                (s.exchange && s.exchange.toUpperCase().includes(query.toUpperCase()));
        });

        if (filtered.length > 0) {
            const table = $(`
                <table class="table table-sm table-hover mb-0" style="font-size: 0.9rem;">
                    <thead class="table-light">
                        <tr>
                            <th style="width: 20%">Symbol</th>
                            <th style="width: 60%">Company</th>
                            <th style="width: 20%">Exchange</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            `);

            const tbody = table.find('tbody');

            filtered.slice(0, 10).forEach(item => {
                const tr = $(`
                    <tr style="cursor: pointer;">
                        <td class="fw-bold text-primary">${item.symbol}</td>
                        <td class="text-truncate" style="max-width: 200px;">${item.company_name || '-'}</td>
                        <td><span class="badge bg-secondary">${(item.exchange || 'UNK').toUpperCase()}</span></td>
                    </tr>
                `);

                tr.click(function () {
                    const fromDate = $('#fromDate').val();
                    const toDate = $('#toDate').val();
                    window.location.href = `/stock/${item.symbol}?from_date=${fromDate}&to_date=${toDate}`;
                });

                tbody.append(tr);
            });

            resultsDiv.append(table);
        } else {
            resultsDiv.append('<div class="p-3 text-muted text-center">No results found</div>');
        }
    }

    $('#floatingInput').keydown(function (e) {
        if (e.key === 'Enter') {
            const firstSymbol = $('#floatingSearchResults tbody tr:first-child td:first-child').text();
            if (firstSymbol) {
                const fromDate = $('#fromDate').val();
                const toDate = $('#toDate').val();
                window.location.href = `/stock/${firstSymbol}?from_date=${fromDate}&to_date=${toDate}`;
            }
        }
    });

    // --- Chart Type Selector ---
    $(document).on('change', '#chartTypeSelector', function () {
        stockChartType = $(this).val();
        localStorage.setItem('stockChartType', stockChartType);
        if (currentStockData && currentStockData.length > 0) {
            updateStockChart(currentStockData);
        }
    });





    // --- Navigation Handlers ---
    $('#nav-market-overview').click(function (e) {
        e.preventDefault();
        const fromDate = $('#fromDate').val();
        const toDate = $('#toDate').val();
        window.location.href = `/?from_date=${fromDate}&to_date=${toDate}`;
    });

    $('#nav-single-stock').click(function (e) {
        e.preventDefault();
        $('#floatingSearchOverlay').fadeIn(200);
        $('#floatingSearchBox').fadeIn(200);
        $('#floatingInput').focus();
    });

    // --- Data Loading & Rendering ---
    function loadData() {
        const fromDate = $('#fromDate').val();
        const toDate = $('#toDate').val();

        let params = new URLSearchParams();
        if (fromDate) params.append('from_date', fromDate);
        if (toDate) params.append('to_date', toDate);

        let symbol = null;
        if (currentMode === 'stock') {
            symbol = $('#currentSymbol').val();
            if (symbol) params.append('symbol', symbol);
        }

        $.get('/api/data?' + params.toString(), function (data) {
            if (currentMode === 'market') {
                renderMarketView(data);
            } else {
                renderStockView(data, symbol);
            }
        });
    }

    function renderMarketView(data) {
        const symbolMap = {};
        const exchMap = {};
        const dailyData = {};

        let totalMatchVol = 0;
        let totalMatchVal = 0;
        let totalStockVol = 0;

        data.forEach(d => {
            // Aggregate by Symbol
            if (!symbolMap[d.stock_symbol]) {
                symbolMap[d.stock_symbol] = {
                    stock_symbol: d.stock_symbol,
                    exchange: d.exchange,
                    match_vol: 0,
                    match_val: 0,
                    stock_vol: 0
                };
            }
            symbolMap[d.stock_symbol].match_vol += d.match_vol;
            symbolMap[d.stock_symbol].match_val += d.match_val;
            symbolMap[d.stock_symbol].stock_vol += d.stock_vol;

            // Aggregate by Exchange
            if (!exchMap[d.exchange]) exchMap[d.exchange] = 0;
            exchMap[d.exchange] += d.match_vol;

            // Aggregate by Date (for Trend Charts)
            if (!dailyData[d.date]) {
                dailyData[d.date] = { date: d.date, match_vol: 0, stock_vol: 0 };
            }
            dailyData[d.date].match_vol += d.match_vol;
            dailyData[d.date].stock_vol += d.stock_vol;

            // Total KPIs
            totalMatchVol += d.match_vol;
            totalMatchVal += d.match_val;
            totalStockVol += d.stock_vol;
        });

        const aggregatedData = Object.values(symbolMap).map(d => ({
            ...d,
            ratio: d.stock_vol > 0 ? (d.match_vol / d.stock_vol * 100) : 0
        }));

        $('#mktTotalMatchVol').text(totalMatchVol.toLocaleString());
        $('#mktTotalMatchVal').text((totalMatchVal / 1e9).toFixed(2) + ' B');

        const topStock = aggregatedData.sort((a, b) => b.match_vol - a.match_vol)[0];
        $('#mktTopStock').text(topStock ? topStock.stock_symbol : '-');

        const avgRatio = totalStockVol > 0 ? (totalMatchVol / totalStockVol * 100) : 0;
        $('#mktAvgRatio').text(avgRatio.toFixed(2) + '%');
        $('#marketDateRange').text(`(${$('#fromDate').val()} to ${$('#toDate').val()})`);

        marketTable.clear().rows.add(aggregatedData).draw();

        currentMarketData = aggregatedData;

        // Prepare sorted dates for trend charts
        const sortedDailyData = Object.values(dailyData).sort((a, b) => new Date(a.date) - new Date(b.date));

        updateMarketCharts(aggregatedData, exchMap, sortedDailyData);

        // Fetch and render 7-day chart
        if (availableDates.length > 0) {
            const last7Dates = availableDates.slice(0, 7);
            const fromDate7 = last7Dates[last7Dates.length - 1];
            const toDate7 = last7Dates[0];

            $.get(`/api/data?from_date=${fromDate7}&to_date=${toDate7}`, function (data7) {
                // Aggregate 7-day data by date
                const dailyData7 = {};
                data7.forEach(d => {
                    if (!dailyData7[d.date]) {
                        dailyData7[d.date] = { date: d.date, match_vol: 0, stock_vol: 0 };
                    }
                    dailyData7[d.date].match_vol += d.match_vol;
                    dailyData7[d.date].stock_vol += d.stock_vol;
                });
                const sorted7DayData = Object.values(dailyData7).sort((a, b) => new Date(a.date) - new Date(b.date));
                update7DayChart(sorted7DayData);
            });
        }
    }

    function renderStockView(data, symbol) {
        if (allSymbols.length > 0) {
            const stockInfo = allSymbols.find(s => s.symbol === symbol);
            if (stockInfo) {
                $('#stockCompanyName').text(stockInfo.company_name);
            }
        }
        let totalMatchVol = 0;
        let maxVol = 0;
        let maxDate = '-';

        const processedData = data.map(d => {
            totalMatchVol += d.match_vol;
            if (d.match_vol > maxVol) {
                maxVol = d.match_vol;
                maxDate = d.date;
            }
            return {
                ...d,
                ratio: d.stock_vol > 0 ? (d.match_vol / d.stock_vol * 100) : 0,
                implied_price: d.match_vol > 0 ? (d.match_val / d.match_vol) : 0
            };
        });

        currentStockData = processedData;
        if ($('#chartTypeSelector').length) {
            $('#chartTypeSelector').val(stockChartType);
        }

        $('#stkTotalMatchVol').text(totalMatchVol.toLocaleString());
        $('#stkAvgMatchVol').text(data.length > 0 ? (totalMatchVol / data.length).toLocaleString(undefined, { maximumFractionDigits: 0 }) : 0);
        $('#stkPeakDate').text(maxDate);

        stockHistoryTable.clear().rows.add(processedData).draw();
        updateStockChart(processedData);
    }

    function updateMarketCharts(aggregatedData, exchMap, sortedDailyData) {
        const top10 = aggregatedData.sort((a, b) => b.match_vol - a.match_vol).slice(0, 10);

        const ctx1 = document.getElementById('topStocksChart');
        if (ctx1) {
            if (topStocksChart) topStocksChart.destroy();

            topStocksChart = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: top10.map(d => d.stock_symbol),
                    datasets: [{
                        label: 'Match Volume',
                        data: top10.map(d => d.match_vol),
                        backgroundColor: '#3498db',
                        hidden: marketChartVisibility['Match Volume']
                    },
                    {
                        label: 'Total Stock Volume',
                        data: top10.map(d => d.stock_vol),
                        backgroundColor: '#95a5a6',
                        hidden: marketChartVisibility['Total Stock Volume']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            onClick: function (e, legendItem, legend) {
                                const index = legendItem.datasetIndex;
                                const ci = legend.chart;
                                if (ci.isDatasetVisible(index)) {
                                    ci.hide(index);
                                    legendItem.hidden = true;
                                } else {
                                    ci.show(index);
                                    legendItem.hidden = false;
                                }
                                const label = legendItem.text;
                                marketChartVisibility[label] = legendItem.hidden;
                                localStorage.setItem('marketChartVisibility', JSON.stringify(marketChartVisibility));
                            }
                        }
                    }
                }
            });
        }

        const ctx2 = document.getElementById('exchangePieChart');
        if (ctx2) {
            if (exchangePieChart) exchangePieChart.destroy();
            exchangePieChart = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(exchMap),
                    datasets: [{
                        data: Object.values(exchMap),
                        backgroundColor: ['#e74c3c', '#2ecc71', '#f1c40f']
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // Total Match/Stock Volume (In Range)
        const ctx3 = document.getElementById('totalVolInRangeChart');
        if (ctx3) {
            if (totalMatchVolChart) totalMatchVolChart.destroy();
            totalMatchVolChart = new Chart(ctx3, {
                type: 'line',
                data: {
                    labels: sortedDailyData.map(d => d.date),
                    datasets: [{
                        label: 'Match Volume',
                        data: sortedDailyData.map(d => d.match_vol),
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.2)',
                        fill: true,
                        tension: 0.3,
                        hidden: marketChartVisibility['Match Volume']
                    },
                    {
                        label: 'Stock Volume',
                        data: sortedDailyData.map(d => d.stock_vol),
                        borderColor: '#95a5a6',
                        backgroundColor: 'rgba(149, 165, 166, 0.2)',
                        fill: true,
                        tension: 0.3,
                        hidden: marketChartVisibility['Stock Volume']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            onClick: function (e, legendItem, legend) {
                                const index = legendItem.datasetIndex;
                                const ci = legend.chart;
                                if (ci.isDatasetVisible(index)) {
                                    ci.hide(index);
                                    legendItem.hidden = true;
                                } else {
                                    ci.show(index);
                                    legendItem.hidden = false;
                                }
                                const label = legendItem.text;
                                marketChartVisibility[label] = legendItem.hidden;
                                localStorage.setItem('marketChartVisibility', JSON.stringify(marketChartVisibility));
                            }
                        }
                    }
                }
            });
        }
    }

    function update7DayChart(sorted7DayData) {
        const ctx4 = document.getElementById('totalVol7DaysChart');
        if (ctx4) {
            if (totalStockVolChart) totalStockVolChart.destroy();
            totalStockVolChart = new Chart(ctx4, {
                type: 'line',
                data: {
                    labels: sorted7DayData.map(d => d.date),
                    datasets: [{
                        label: 'Match Volume',
                        data: sorted7DayData.map(d => d.match_vol),
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.2)',
                        fill: true,
                        tension: 0.3,
                        hidden: marketChartVisibility['Match Volume']
                    },
                    {
                        label: 'Stock Volume',
                        data: sorted7DayData.map(d => d.stock_vol),
                        borderColor: '#95a5a6',
                        backgroundColor: 'rgba(149, 165, 166, 0.2)',
                        fill: true,
                        tension: 0.3,
                        hidden: marketChartVisibility['Stock Volume']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            onClick: function (e, legendItem, legend) {
                                const index = legendItem.datasetIndex;
                                const ci = legend.chart;
                                if (ci.isDatasetVisible(index)) {
                                    ci.hide(index);
                                    legendItem.hidden = true;
                                } else {
                                    ci.show(index);
                                    legendItem.hidden = false;
                                }
                                const label = legendItem.text;
                                marketChartVisibility[label] = legendItem.hidden;
                                localStorage.setItem('marketChartVisibility', JSON.stringify(marketChartVisibility));
                            }
                        }
                    }
                }
            });
        }
    }

    function updateStockChart(data) {
        const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date));

        const ctx = document.getElementById('stockHistoryChart');
        if (ctx) {
            if (stockHistoryChart) stockHistoryChart.destroy();

            const isLine = stockChartType === 'line';

            stockHistoryChart = new Chart(ctx, {
                type: stockChartType,
                data: {
                    labels: sorted.map(d => d.date),
                    datasets: [
                        {
                            label: 'Match Volume',
                            data: sorted.map(d => d.match_vol),
                            backgroundColor: isLine ? 'rgba(52, 152, 219, 0.2)' : '#3498db',
                            borderColor: '#3498db',
                            borderWidth: isLine ? 2 : 0,
                            fill: isLine,
                            tension: isLine ? 0.3 : 0,
                            pointRadius: isLine ? 3 : 0,
                            order: 1,
                            hidden: stockChartVisibility['Match Volume']
                        },
                        {
                            label: 'Total Stock Vol',
                            data: sorted.map(d => d.stock_vol),
                            backgroundColor: isLine ? 'rgba(149, 165, 166, 0.2)' : '#95a5a6',
                            borderColor: '#95a5a6',
                            borderWidth: isLine ? 2 : 0,
                            fill: isLine,
                            tension: isLine ? 0.3 : 0,
                            pointRadius: isLine ? 3 : 0,
                            order: 2,
                            hidden: stockChartVisibility['Total Stock Vol']
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            onClick: function (e, legendItem, legend) {
                                const index = legendItem.datasetIndex;
                                const ci = legend.chart;
                                if (ci.isDatasetVisible(index)) {
                                    ci.hide(index);
                                    legendItem.hidden = true;
                                } else {
                                    ci.show(index);
                                    legendItem.hidden = false;
                                }
                                const label = legendItem.text;
                                stockChartVisibility[label] = legendItem.hidden;
                                localStorage.setItem('stockChartVisibility', JSON.stringify(stockChartVisibility));
                            }
                        }
                    }
                }
            });
        }
    }

    $('#btnToday').click(function () {
        const today = new Date().toISOString().split('T')[0];
        const fromPicker = document.querySelector("#fromDate")._flatpickr;
        const toPicker = document.querySelector("#toDate")._flatpickr;

        if (fromPicker) fromPicker.setDate(today);
        if (toPicker) toPicker.setDate(today);
    });

    $('#applyFilters').click(function () {
        const fromDate = $('#fromDate').val();
        const toDate = $('#toDate').val();

        // Update URL without reloading
        const url = new URL(window.location);
        url.searchParams.set('from_date', fromDate);
        url.searchParams.set('to_date', toDate);
        window.history.pushState({}, '', url);

        loadData();
    });
    $('#exportBtn').click(function () {
        const fromDate = $('#fromDate').val();
        const toDate = $('#toDate').val();
        let params = new URLSearchParams();
        if (fromDate) params.append('from_date', fromDate);
        if (toDate) params.append('to_date', toDate);
        if (currentMode === 'stock') {
            const symbol = $('#currentSymbol').val();
            if (symbol) params.append('symbol', symbol);
        }
        window.open('/api/export?' + params.toString(), '_blank');
    });

    $('#triggerJobBtn').click(function () {
        const btn = $(this);
        btn.prop('disabled', true).text('Fetching...');
        $.post('/api/trigger-job', function (response) {
            alert('Job triggered! Data will be available in a moment.');
            btn.prop('disabled', false).html('<i class="fas fa-cloud-download-alt me-1"></i> Fetch Latest Data');
            // Refresh data and last update timestamp after a delay
            setTimeout(function () {
                loadData();
                loadLastUpdate();
            }, 5000);
        });
    });
});
